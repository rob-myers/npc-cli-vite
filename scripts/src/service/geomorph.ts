import { isHullSymbolImageKey } from "@npc-cli/media/starship-symbol";
import {
  filterNodes,
  type GeomorphKey,
  isGeomorphKey,
  type MapEditSavedMap,
  type MapEditSavedSymbol,
  type MapNode,
  type SymbolMapNode,
} from "@npc-cli/ui__map-edit/map-node-api";
import "@npc-cli/ui__world/geomorph.d.ts";
import { geomService, Mat, Poly } from "@npc-cli/util";
import { tagsToMeta, textToTags } from "@npc-cli/util/legacy/generic";

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
  const allNodes = filterNodes(savedFile.nodes, (_node: MapNode): _node is MapNode => true);

  const walls: Geomorph.Symbol["walls"] = [];
  // 🚧

  for (const node of allNodes) {
    const meta = tagsToMeta(textToTags(node.name));
    const poly = mapNodeToPoly(node);
    if (poly !== null) {
      meta.wall === true && walls.push(poly);
    }
  }

  return {
    key: savedFile.key,
    isHull: isHullSymbolImageKey(savedFile.key),
    width: savedFile.width,
    height: savedFile.height,
    bounds: savedFile.bounds,
    walls,
    // 🚧
  };
}

function mapNodeToPoly(node: MapNode): Poly | null {
  if (node.type === "rect") {
    const { a, b, c, d, e, f } = node.transform;
    const mat = new Mat([a, b, c, d, e, f]);
    return Poly.fromRect({ x: 0, y: 0, ...node.baseRect }).applyMatrix(mat);
  }

  if (node.type === "path") {
    const { a, b, c, d, e, f } = node.transform;
    const mat = new Mat([a, b, c, d, e, f]);
    return geomService.svgPathToPolygon(node.d)?.applyMatrix(mat) ?? null;
  }

  return null;
}
