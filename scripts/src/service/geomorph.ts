import { isHullSymbolImageKey } from "@npc-cli/media/starship-symbol";
import {
  filterNodes,
  type GeomorphKey,
  isGeomorphKey,
  type MapEditSavedMap,
  type MapEditSavedSymbol,
  type SymbolMapNode,
} from "@npc-cli/ui__map-edit/map-node-api";
import "@npc-cli/ui__world/geomorph.d.ts";

export function parseMapEditMap(savedFile: MapEditSavedMap): Geomorph.MapDef {
  type GeomorphNode = SymbolMapNode & { srcKey: GeomorphKey };
  const geomorphNodes = filterNodes(
    savedFile.nodes,
    (node): node is GeomorphNode => node.type === "symbol" && node.srcKey !== null && isGeomorphKey(node.srcKey),
  );

  return {
    key: savedFile.key,
    gms: geomorphNodes.map((gm) => ({
      gmKey: gm.srcKey,
      transform: gm.transform,
    })),
  };
}

export function parseMapEditSymbol(savedFile: MapEditSavedSymbol): Geomorph.Symbol {
  return {
    key: savedFile.key,
    isHull: isHullSymbolImageKey(savedFile.key),
    width: savedFile.width,
    height: savedFile.height,
    bounds: savedFile.bounds,
    // 🚧 compute walls
    // 🚧 compute doors
  };
}
