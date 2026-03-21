import { getGeomorphNumber, isHullSymbolImageKey, type StarShipGeomorphKey } from "@npc-cli/media/starship-symbol";
import {
  type AssetsType,
  type DecorImageMapNode,
  filterNodes,
  isDecorImageMapNode,
  type MapEditSavedMap,
  type MapEditSavedSymbol,
  type MapNode,
  type SymbolMapNode,
  type SymbolPolysKey,
} from "@npc-cli/ui__map-edit/map-node-api";
import "@npc-cli/ui__world/geomorph.d.ts";
import { geomService, Mat, Poly, Rect, Vect } from "@npc-cli/util/geom";
import { debug, tagsToMeta, textToTags, toPrecision } from "@npc-cli/util/legacy/generic";
import { warn } from "console";

function applyDecorMetaRewrites(meta: Meta): void {
  if (typeof meta.switch === "number") {
    meta.y = doorSwitchHeight;
    meta.tilt = true; // 90° so in XY plane
  }
}

/**
 * 🚧 needs review
 *
 * Compute flattened doors and decor:
 * - ensure decor `switch={doorId}` points to correct `doorId`
 * - when doors are close (e.g. coincide) remove later door
 * - ensure resp. switches removed, set other two as "inner"
 */
function computeFlattenedDoors(
  logPrefix: string,
  symbol: Geomorph.Symbol,
  flats: Geomorph.FlatSymbol[],
): { flatDoors: Poly[]; flatDecor: Poly[] } {
  // ensure `decor.meta.switch` points to correct doorId
  let doorIdOffset = symbol.doors.length;
  const flatDoors = symbol.doors.concat(
    flats.flatMap((flat) => {
      flat.decor.forEach((d) => typeof d.meta.switch === "number" && (d.meta.switch += doorIdOffset));
      doorIdOffset += flat.doors.length;
      return flat.doors;
    }),
  );

  // detect coinciding doors e.g. from 102
  const centers = flatDoors.map((d) => d.center);
  const rmDoorIds = new Set<number>();
  const keptDoorIds = new Set<number>();
  centers.forEach((center, i) => {
    if (rmDoorIds.has(i)) return;
    for (let j = i + 1; j < centers.length; j++)
      if (Math.abs(center.x - centers[j].x) < 0.1 && Math.abs(center.y - centers[j].y) < 0.1) {
        debug(`${logPrefix}: removed door coinciding with ${i} (${j})`);
        keptDoorIds.add(i);
        rmDoorIds.add(j);
      }
  });

  const flatDecor = symbol.decor.concat(flats.flatMap((x) => x.decor));
  let switchIdOffset = 0; // adjust switches on remove door
  const seenRmDoorId = new Set<number>();

  return {
    flatDoors: flatDoors.filter((_, i) => !rmDoorIds.has(i)),
    flatDecor: flatDecor.filter((d) => {
      if (typeof d.meta.switch === "number") {
        if (rmDoorIds.has(d.meta.switch)) {
          // remove resp. switch
          if (!seenRmDoorId.has(d.meta.switch)) {
            switchIdOffset--;
            seenRmDoorId.add(d.meta.switch);
          }
          return false;
        }
        if (keptDoorIds.has(d.meta.switch)) {
          d.meta.inner = true; // set kept switches inner
        }
        d.meta.switch += switchIdOffset; // adjust for prior removals
      }
      return true;
    }),
  };
}

/**
 * @param flat Flat hull symbol
 */
export function createLayout(
  gmKey: StarShipGeomorphKey,
  flat: Geomorph.FlatSymbol,
  _assets: AssetsType,
): Geomorph.GeomorphLayout {
  debug(`createLayout ${gmKey}`);

  return {
    key: gmKey,
    bounds: flat.bounds,
    num: getGeomorphNumber(gmKey),
    // 🚧
    decor: [],
    doors: [],
    obstacles: [],
    walls: [],
  };
}

function extractDecorPoly(node: DecorImageMapNode, meta: Meta): Poly | null {
  const poly = Poly.fromRect(new Rect(0, 0, node.baseRect.width, node.baseRect.height));
  poly.meta = meta;

  const mat = tmpMat1.setMatrixValue(node.transform).precision(precision);
  poly.applyMatrix(mat);

  if (meta.cuboid === true || meta.quad === true) {
    // - preserve transform for shader later, so can transform quad from the spritesheet
    // - physical coords provided by `poly` e.g. for collision detection
    // - during symbol flattening `transformDecorMeta` expects tuple
    poly.meta.transform = mat.toArray();
  } else {
    // fallback to decor point
    meta.point = true;
    meta.direction = tmpVect1.set(mat.a, mat.b).normalize().json;
  }

  applyDecorMetaRewrites(meta);

  return poly;
}

export function flattenSymbol(symbol: Geomorph.Symbol, flattened: AssetsType["flattened"]): void {
  const { key, isHull, walls, obstacles, symbols } = symbol;

  const flats = symbols.flatMap(({ symbolKey, meta, transform }) => {
    const flat = flattened[symbolKey];
    if (flat) {
      return instantiateFlatSymbol(flat, meta, transform);
    } else {
      warn(`Missing flattened symbol for key ${symbolKey}`);
      return [];
    }
  });

  const { flatDoors, flatDecor } = computeFlattenedDoors(symbol.key, symbol, flats);

  flattened[key] = {
    key,
    isHull,
    bounds: symbol.bounds,
    width: symbol.width,
    height: symbol.height,
    // not aggregated, only cloned
    walls: walls.concat(flats.flatMap((x) => x.walls)),
    obstacles: obstacles.concat(flats.flatMap((x) => x.obstacles)),
    doors: flatDoors,
    decor: flatDecor,
    // 🚧
    // addableWalls: addableWalls.map(x => x.cleanClone()),
    // removableDoors: removableDoors.map(x => ({ ...x, wall: x.wall.cleanClone() })),
    // aggregated and cloned
    // unsorted: unsorted.concat(flats.flatMap(x => x.unsorted)),
    // windows: windows.concat(flats.flatMap(x => x.windows)),
  };
}

/**
 * 🚧 support removable doors/walls
 */
export function instantiateFlatSymbol(
  sym: Geomorph.FlatSymbol,
  meta: Meta<{ doors?: string[]; walls?: string[] }>,
  transform: Geom.AffineTransform,
): Geomorph.FlatSymbol {
  const mat = tmpMat1.setMatrixValue(transform);

  const decor = sym.decor.map((poly) => poly.cleanClone(mat, transformDecorMeta(poly.meta, mat, meta.y)));

  return {
    key: sym.key,
    isHull: sym.isHull,
    width: sym.width,
    height: sym.height,
    bounds: sym.bounds,
    decor,
    doors: sym.doors.map((poly) => poly.cleanClone(mat)),
    obstacles: sym.obstacles.map((poly) =>
      poly.cleanClone(mat, {
        // aggregate height from MapEdit symbols
        ...(typeof meta.y === "number" && {
          y: toPrecision(meta.y + (parseInt(poly.meta.y, 10) || 0)),
        }),
        // - compute transform during symbol flattening
        // - only place we set `meta.transform` for obstacles
        ...{
          transform: tmpMat2
            .setMatrixValue(transform)
            .preMultiply(poly.meta.transform ?? [1, 0, 0, 1, 0, 0])
            .toArray(),
        },
      }),
    ),
    walls: sym.walls.map((poly) => poly.cleanClone(tmpMat1)),
  };
}

function mapNodeToPoly(node: MapNode, meta: Meta): Poly | null {
  switch (node.type) {
    case "rect": {
      const { a, b, c, d, e, f } = node.transform;
      const mat = new Mat([a, b, c, d, e, f]);
      return Poly.fromRect({ x: 0, y: 0, ...node.baseRect }).applyMatrix(mat);
    }
    case "path": {
      const { a, b, c, d, e, f } = node.transform;
      const mat = new Mat([a, b, c, d, e, f]);
      return geomService.svgPathToPolygon(node.d)?.applyMatrix(mat) ?? null;
    }
    case "image": {
      if (isDecorImageMapNode(node)) {
        return extractDecorPoly(node, meta);
      }
      break;
    }
  }

  return null;
}

export function parseMapEditMap(savedFile: MapEditSavedMap): Geomorph.MapDef {
  type GeomorphNode = SymbolMapNode & { srcKey: StarShipGeomorphKey };
  const geomorphNodes = filterNodes(
    savedFile.nodes,
    (node): node is GeomorphNode => node.type === "symbol" && node.srcKey !== null && isHullSymbolImageKey(node.srcKey),
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

  const symbols = [] as Geomorph.Symbol["symbols"];

  const polysLookup: Record<SymbolPolysKey, Geomorph.Symbol[SymbolPolysKey]> = {
    decor: [] as Geomorph.Symbol["decor"],
    doors: [] as Geomorph.Symbol["doors"],
    hullWalls: [] as Geomorph.Symbol["hullWalls"],
    obstacles: [] as Geomorph.Symbol["obstacles"],
    walls: [] as Geomorph.Symbol["walls"],
  };

  for (const node of allNodes) {
    const ownTags = textToTags(node.name);
    const meta = tagsToMeta(ownTags);

    if (node.type === "symbol") {
      node.srcKey !== null &&
        symbols.push({
          symbolKey: node.srcKey,
          width: node.baseRect.width,
          height: node.baseRect.height,
          transform: node.transform,
          meta,
        });
      continue;
    }

    const poly = mapNodeToPoly(node, meta)?.precision(precision).cleanFinalReps().fixOrientation() ?? null;
    if (poly === null) continue;

    for (const [tag, polysKey] of Object.values(tagPolysKeyPairs)) {
      meta[tag] === true && polysLookup[polysKey].push(poly);
    }

    if (meta.wall === true && meta.hull === true) {
      polysLookup.hullWalls.push(poly);
    }

    if (meta.switch === true) {
      // switches are aligned to doors
      meta.switch = polysLookup.doors.length - 1;
    }
    if (meta.obstacle === true) {
      // Link to original symbol
      meta.symKey = savedFile.key;
      // local id inside SVG symbol
      meta.obsId = polysLookup.obstacles.length - 1;
    }
  }

  return {
    key: savedFile.key,
    isHull: isHullSymbolImageKey(savedFile.key),
    width: savedFile.width,
    height: savedFile.height,
    bounds: savedFile.bounds,

    ...polysLookup,
    symbols,
    // 🚧 ...
  };
}

/**
 * For nested symbols i.e. before decor becomes `Geomorph.Decor`
 */
export function transformDecorMeta(meta: Meta, mat: Mat, y?: number): Meta {
  /** if `y=0` place decor "on the ground" otherwise aggregate `y` */
  const nextY = meta.y === 0 ? 0.01 : (parseInt(String(y), 10) || 0) + (parseInt(String(meta.y), 10) || 0.01);
  const nextH = meta.h;

  return {
    ...meta,
    y: nextY,
    h: nextH,
    ...(Array.isArray(meta.transform) && {
      transform: tmpMat2
        .setMatrixValue(tmpMat1)
        // 🔔 meta.transform should be tuple representation of decor image node's transform
        .preMultiply(meta.transform as Geom.SixTuple)
        .toArray(),
    }),
    ...(meta.direction !== undefined && {
      direction: mat.transformSansTranslate({ ...meta.direction }),
    }),
  };
}

const tagPolysKeyPairs = Object.entries({
  decor: "decor",
  door: "doors",
  obstacle: "obstacles",
  wall: "walls",
} satisfies Record<string, SymbolPolysKey>);

const tmpMat1 = new Mat();
const tmpMat2 = new Mat();
const tmpVect1 = new Vect();

const doorSwitchHeight = 1;
const precision = 4;
