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
import { isHullSymbolImageKey } from "@npc-cli/media/starship-symbol";
import type { MapEditSavedMap, MapEditSavedSymbol } from "@npc-cli/ui__map-edit/editor.schema";
import { getLocalStorageDrafts } from "@npc-cli/ui__map-edit/map-node-api";
import { info, pause } from "@npc-cli/util/legacy/generic";
import type { AssetsType } from "../assets.schema";
import { createLayout, createMapDefFromSavedFile, flattenSymbols, parseSymbolFromSavedFile } from "./geomorph";

/**
 * - Browser-side version of dev-server `pnpm gen-assets-json` i.e.
 *   - updateChangedSymbolsAndMaps
 *   - stratifySymbols
 *   - flattenSymbols
 *   - createLayout
 *
 * - Applies all `localStorage` drafts one-per-symbol, only changing ancestral symbols and their layouts.
 * - In practice we'll probably only change hull-symbols
 */
export async function recomputeAssetsViaDrafts(assets: AssetsType): Promise<void> {
  const drafts = "localStorage" in self ? getLocalStorageDrafts() : [];

  const mapEditMapDrafts = drafts.filter((x): x is MapEditSavedMap => x.type === "map");

  if (mapEditMapDrafts.length > 0) {
    info("[recomputeAssetsViaDrafts] applying localStorage map drafts");

    for (const draft of mapEditMapDrafts) {
      const map = createMapDefFromSavedFile(draft);
      assets.map[map.key] = map;
    }
  }

  const mapEditSymbolDrafts = drafts.filter((x): x is MapEditSavedSymbol => x.type === "symbol");
  if (mapEditSymbolDrafts.length === 0) {
    return;
  }

  info("[recomputeAssetsViaDrafts] applying localStorage symbol drafts");

  for (const draft of mapEditSymbolDrafts) {
    const symbol = parseSymbolFromSavedFile(draft);
    assets.symbol[symbol.key] = symbol;
    await pause(0);
  }

  await pause(30);

  const symbolGraph = SymbolGraph.from(assets.symbol);
  const draftSymbolKeys = mapEditSymbolDrafts.map((draft) => draft.key);
  // edges "symbol -> sub-symbol" so need co-reachable
  const coReachableNodes = symbolGraph.getCoReachableNodes(draftSymbolKeys);
  const ancestralSymbolKeys = coReachableNodes.map((node) => node.id);
  const subStratification = symbolGraph.stratify(new Set(coReachableNodes));

  // console.log({
  //   draftSymbolKeys,
  //   ancestralSymbolKeys,
  //   coReachableNodes: coReachableNodes.map((n) => n.id),
  //   subStratification: subStratification.map((level) => level.map((n) => n.id)),
  // });

  await pause(30);

  // follow approach in gen-assets-json
  flattenSymbols(subStratification, assets);
  for (const gmKey of ancestralSymbolKeys.filter(isHullSymbolImageKey)) {
    const flat = assets.flattened[gmKey] as Geomorph.FlatSymbol;
    assets.layout[gmKey] = createLayout(gmKey, flat, assets);
    await pause(0);
  }
}
