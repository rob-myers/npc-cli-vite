/**
 * Browser-side layout recomputation.
 *
 * In prod, users can edit hull symbols via MapEdit, saving drafts to localStorage.
 * We cannot re-run the node script `gen-assets-json`, but the core pipeline
 * (parseMapEditSymbol -> stratify -> flattenSymbol -> createLayout) is pure JS.
 *
 * This module overlays localStorage drafts onto fetched assets.json,
 * re-flattening and re-laying-out all hull symbols.
 */
import { isHullSymbolImageKey, type StarshipSymbolImageKey } from "@npc-cli/media/starship-symbol";
import { MapEditSavedFileSchema } from "@npc-cli/ui__map-edit/editor.schema";
import { getFileSpecifierLocalStorageKey, getLocalStorageFileSpecs } from "@npc-cli/ui__map-edit/map-node-api";
import { jsonParser } from "@npc-cli/util/json-parser";
import { entries, info, tryLocalStorageGet, warn } from "@npc-cli/util/legacy/generic";
import type { AssetsType } from "../assets.schema";
import * as geomorph from "./geomorph";

/**
 * Overlay any localStorage symbol drafts onto `baseAssets`,
 * re-flatten all symbols, and recompute hull layouts.
 */
export function recomputeFromLocalStorageDrafts(assets: AssetsType): boolean {
  const drafts = getLocalStorageFileSpecs().filter((f) => f.type === "symbol");
  if (drafts.length === 0) return false;

  let changed = false;
  for (const draft of drafts) {
    const raw = tryLocalStorageGet(getFileSpecifierLocalStorageKey(draft));
    const parsed = jsonParser.pipe(MapEditSavedFileSchema).safeParse(raw);
    if (!parsed.success || parsed.data.type !== "symbol") continue;

    const symbol = geomorph.parseMapEditSymbol(parsed.data);
    assets.symbol[symbol.key] = symbol;
    changed = true;
  }

  if (!changed) return false;

  info("[recompute-layout] overlaying localStorage drafts");

  // stratify: topological sort from leaves to roots
  const stratified = stratifySymbols(assets.symbol);

  // flatten all symbols in dependency order
  const flattened: AssetsType["flattened"] = {};
  for (const level of stratified) {
    for (const symbolKey of level) {
      const symbol = assets.symbol[symbolKey];
      if (symbol) {
        geomorph.flattenSymbol(symbol, flattened);
      }
    }
  }
  assets.flattened = flattened;

  // recompute layouts for hull symbols
  for (const [symbolKey, flat] of entries(assets.flattened)) {
    if (!isHullSymbolImageKey(symbolKey)) continue;
    assets.layout[symbolKey] = geomorph.createLayout(symbolKey, flat, assets);
  }

  return true;
}

/**
 * Topological sort of symbol dependency graph (leaves first).
 * Inlined from `@npc-cli/graph` SymbolGraph + BaseGraph.stratify()
 * to avoid a circular dependency (`@npc-cli/graph` depends on `@npc-cli/ui__world`).
 */
function stratifySymbols(symbols: AssetsType["symbol"]): StarshipSymbolImageKey[][] {
  // build adjacency: symbol -> its sub-symbol keys (successors/dependencies)
  const succs = new Map<StarshipSymbolImageKey, StarshipSymbolImageKey[]>();
  for (const [key, symbol] of entries(symbols)) {
    succs.set(
      key,
      symbol.symbols.map((s) => s.symbolKey),
    );
  }

  const allKeys = [...succs.keys()];
  const seen = new Set<StarshipSymbolImageKey>();
  const output: StarshipSymbolImageKey[][] = [];
  let unseen = allKeys;

  while (true) {
    const frontier: StarshipSymbolImageKey[] = [];
    unseen = unseen.filter((key) => {
      const deps = succs.get(key) ?? [];
      if (deps.every((dep) => seen.has(dep))) {
        frontier.push(key);
        return false;
      }
      return true;
    });
    if (frontier.length === 0) break;
    for (const key of frontier) seen.add(key);
    output.push(frontier);
  }

  if (unseen.length) {
    warn(`stratifySymbols: ignoring ${unseen.length} nodes (cycles?)`);
  }

  return output;
}

/** Custom event name dispatched by MapEdit on symbol save */
export const symbolSavedEvent = "map-edit:symbol-saved";
