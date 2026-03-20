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

export function parseMapEditSubSymbol(node: SymbolMapNode, meta: Meta): Geomorph.SubSymbol | null {
  return node.srcKey === null
    ? null
    : {
        symbolKey: node.srcKey,
        width: node.baseRect.width,
        height: node.baseRect.height,
        transform: node.transform,
        meta,
      };
}

export function parseMapEditSymbol(savedFile: MapEditSavedSymbol): Geomorph.Symbol {
  const allNodes = filterNodes(savedFile.nodes, (_node: MapNode): _node is MapNode => true);

  const walls: Geomorph.Symbol["walls"] = [];
  const obstacles: Geomorph.Symbol["obstacles"] = [];
  const doors: Geomorph.Symbol["doors"] = [];
  const symbols: Geomorph.Symbol["symbols"] = [];
  // 🚧 ...

  for (const node of allNodes) {
    const ownTags = textToTags(node.name);
    const meta = tagsToMeta(ownTags);

    if (node.type === "symbol") {
      const subSymbol = parseMapEditSubSymbol(node, meta);
      subSymbol !== null && symbols.push(subSymbol);
    }

    const poly = mapNodeToPoly(node);
    if (poly !== null) {
      meta.door === true && doors.push(poly);
      meta.obstacle === true && obstacles.push(poly);
      meta.wall === true && walls.push(poly);
    }
  }

  return {
    key: savedFile.key,
    isHull: isHullSymbolImageKey(savedFile.key),
    width: savedFile.width,
    height: savedFile.height,
    bounds: savedFile.bounds,

    doors,
    obstacles,
    walls,
    symbols,
    // 🚧 ...
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
