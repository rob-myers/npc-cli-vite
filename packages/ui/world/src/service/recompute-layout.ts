/**
 * Browser-side layout recomputation in production.
 *
 * In production users can edit symbols via MapEdit, with drafts auto-saving to localStorage.
 * We cannot re-run the node script `gen-assets-json` in production (no backend).
 * However, the core pipeline is pure JS:
 * > parseMapEditSymbol -> stratify -> flattenSymbol -> createLayout
 *
 * This module overlays every localStorage drafts onto the previously fetched "assets.json",
 * re-flattening and re-laying-out each recursively dependent symbol.
 */

import { SymbolGraph } from "@npc-cli/graph";
import { isHullSymbolImageKey, type StarshipSymbolImageKey } from "@npc-cli/media/starship-symbol";
import { MapEditSavedFileSchema, type MapEditSavedSymbol } from "@npc-cli/ui__map-edit/editor.schema";
import {
  getFileSpecifierLocalStorageKey,
  getLocalStorageDrafts,
  getLocalStorageFileSpecs,
} from "@npc-cli/ui__map-edit/map-node-api";
import { jsonParser } from "@npc-cli/util/json-parser";
import { entries, info, tryLocalStorageGet, warn } from "@npc-cli/util/legacy/generic";
import type { AssetsType } from "../assets.schema";
import { createLayout, flattenSymbol, flattenSymbols, parseSymbolFromSavedFile } from "./geomorph";

/**
 * - Browser side version of dev-server `gen-assets-json`:
 *   > updateChangedSymbolsAndMaps -> stratifySymbols -> flattenSymbols -> createLayout
 * - Apply all drafts stored in localStorage one-per-symbol
 * - 🚧 Future work: grouped-drafts for multiple saves.
 */
export function recomputeAssetsInProduction(assets: AssetsType): void {
  const mapEditSymbolDrafts = ("localStorage" in self ? getLocalStorageDrafts() : []).filter(
    (x): x is MapEditSavedSymbol => x.type === "symbol",
  );

  if (mapEditSymbolDrafts.length === 0) {
    return;
  }

  info("[recomputeAssetsInProduction] overlaying localStorage symbol drafts");

  for (const draft of mapEditSymbolDrafts) {
    const symbol = parseSymbolFromSavedFile(draft);
    assets.symbol[symbol.key] = symbol;
  }

  const symbolGraph = SymbolGraph.from(assets.symbol);
  const draftSymbolKeys = mapEditSymbolDrafts.map((draft) => draft.key);
  // edges "symbol -> sub-symbol" so need co-reachable
  const coReachableNodes = symbolGraph.getCoReachableNodes(draftSymbolKeys);
  const effectedSymbolKeys = coReachableNodes.map((node) => node.id);
  const subStratification = symbolGraph.stratify(new Set(coReachableNodes));

  // console.log({
  //   draftSymbolKeys,
  //   effectedSymbolKeys,
  //   coReachableNodes: coReachableNodes.map((n) => n.id),
  //   subStratification: subStratification.map((level) => level.map((n) => n.id)),
  // });

  // follow approach in gen-assets-json
  flattenSymbols(subStratification, assets);
  for (const gmKey of effectedSymbolKeys.filter(isHullSymbolImageKey)) {
    const flat = assets.flattened[gmKey] as Geomorph.FlatSymbol;
    assets.layout[gmKey] = createLayout(gmKey, flat, assets);
  }
}

/**
 * - Overlay any localStorage symbol drafts onto `baseAssets`,
 *   re-flatten all symbols, and recompute hull layouts.
 * - This supports arbitrary symbol edits, not only hull symbols.
 */
export function recomputeAllSymbolsFromLocalStorageDrafts(assets: AssetsType): boolean {
  const drafts = getLocalStorageFileSpecs().filter((f) => f.type === "symbol");
  if (drafts.length === 0) return false;

  let changed = false;
  for (const draft of drafts) {
    const raw = tryLocalStorageGet(getFileSpecifierLocalStorageKey(draft));
    const parsed = jsonParser.pipe(MapEditSavedFileSchema).safeParse(raw);
    if (!parsed.success || parsed.data.type !== "symbol") continue;

    const symbol = parseSymbolFromSavedFile(parsed.data);
    assets.symbol[symbol.key] = symbol;
    changed = true;
  }

  if (!changed) return false;

  info("[recompute-all-symbols] overlaying localStorage drafts");

  // stratify: topological sort from leaves to roots
  const stratified = stratifySymbols(assets.symbol);

  // flatten all symbols in dependency order
  const flattened: AssetsType["flattened"] = {};
  for (const level of stratified) {
    for (const symbolKey of level) {
      const symbol = assets.symbol[symbolKey];
      if (symbol) {
        flattenSymbol(symbol, flattened);
      }
    }
  }
  assets.flattened = flattened;

  // recompute layouts for hull symbols
  for (const [symbolKey, flat] of entries(assets.flattened)) {
    if (!isHullSymbolImageKey(symbolKey)) continue;
    assets.layout[symbolKey] = createLayout(symbolKey, flat, assets);
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
