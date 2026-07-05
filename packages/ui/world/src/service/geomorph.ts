import {
  getGeomorphNumber,
  isHullSymbolImageKey,
  type StarShipGeomorphKey,
  type StarshipGeomorphNumber,
  type StarshipSymbolImageKey,
} from "@npc-cli/media/starship-symbol";
import "@npc-cli/ui__world/geomorph.d.ts";
import type { SymbolGraphNode } from "@npc-cli/graph";
import {
  type DecorImageMapNode,
  isDecorImageMapNode,
  type MapEditSavedMap,
  type MapEditSavedSymbol,
  type MapNode,
  type SymbolMapNode,
} from "@npc-cli/ui__map-edit/editor.schema";
import { filterNodes } from "@npc-cli/ui__map-edit/map-node-api";
import type { AssetsType, SymbolPolysKey } from "@npc-cli/ui__world/assets.schema";
import { Mat, Poly, Rect, Vect } from "@npc-cli/util/geom";
import { geomService } from "@npc-cli/util/geom-service";
import { debug, deepClone, error, tagsToMeta, textToTags, toPrecision, warn } from "@npc-cli/util/legacy/generic";
import {
  decorPointDefaultRadius,
  doorSwitchHeight,
  obstacleOutset,
  precision,
  sguToWorldScale,
  specialWallMetaKeys,
  wallOutset,
} from "../const";
import { Connector } from "./Connector";
import { embedXZMat4 } from "./geometry";

/**
 * Compute flattened doors, decor, obstacles,
 * appropiately restricted with mutated meta.
 *
 * - ensure decor `obstacleId={obstacleId}` points to correct `obstacleId`
 * - ensure decor `doorId={doorId}` points to correct `doorId`
 * - when doors are close (e.g. coincide) remove later door
 * - on remove door ensure respective decor removed
 */
function computeFlatDoorsDecorObstacles(
  logPrefix: string,
  symbol: Geomorph.Symbol,
  flats: Geomorph.FlatSymbol[],
): { flatDoors: Poly[]; flatDecor: Poly[] } {
  // ensure decor `obstacleId={obstacleId}` points to correct `obstacleId`
  // 🔔 independent of decor removal below; we never remove obstacles
  let obstacleIdOffset = symbol.obstacles.length;
  flats.forEach((flat) => {
    flat.decor.forEach((d) => typeof d.meta.obstacleId === "number" && (d.meta.obstacleId += obstacleIdOffset));
    obstacleIdOffset += flat.obstacles.length;
  });

  // ensure `decor.meta.doorId` points to correct doorId
  let doorIdOffset = symbol.doors.length;
  const flatDoors = symbol.doors.concat(
    flats.flatMap((flat) => {
      flat.decor.forEach((d) => typeof d.meta.doorId === "number" && (d.meta.doorId += doorIdOffset));
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

  // on remove door ensure respective decor removed
  const flatDecor = symbol.decor.map((x) => x.cleanClone()).concat(flats.flatMap((x) => x.decor));
  let rmDoorIdOffset = 0;
  const seenRmDoorId = new Set<number>();
  const filteredFlatDecor = flatDecor.filter((d) => {
    if (typeof d.meta.doorId === "number") {
      if (rmDoorIds.has(d.meta.doorId)) {
        // remove resp. switch
        if (!seenRmDoorId.has(d.meta.doorId)) {
          rmDoorIdOffset--;
          seenRmDoorId.add(d.meta.doorId);
        }
        return false;
      }
      d.meta.doorId += rmDoorIdOffset; // adjust for prior removals
    }
    return true;
  });

  return {
    flatDoors: flatDoors.filter((_, doorId) => !rmDoorIds.has(doorId)),
    flatDecor: filteredFlatDecor,
  };
}

function convertMapEditNodeToPoly(node: MapNode, meta: Meta): Poly | null {
  switch (node.type) {
    case "rect": {
      const { a, b, c, d, e, f } = node.transform;
      const mat = new Mat([a, b, c, d, e, f]);
      return Poly.fromRect({ x: 0, y: 0, ...node.baseRect })
        .applyMatrix(mat)
        .setMeta(meta);
    }
    case "path": {
      const { a, b, c, d, e, f } = node.transform;
      const mat = new Mat([a, b, c, d, e, f]);
      return geomService.svgPathToPolygon(node.d)?.applyMatrix(mat)?.setMeta(meta) ?? null;
    }
    case "image": {
      if (isDecorImageMapNode(node)) {
        return extractDecorPolyFromMapEditNode(node, meta);
      }
      break;
    }
  }

  return null;
}

function createEmptyLayout(gmKey: StarShipGeomorphKey, flat: Geomorph.FlatSymbol): Geomorph.Layout {
  return {
    key: gmKey,
    bounds: flat.bounds,
    num: getGeomorphNumber(gmKey),

    decor: [],
    doors: [],
    hullPoly: [],
    obstacles: [],
    rooms: [],
    unsorted: [],
    walls: [],
    windows: [],

    navDecomp: { vs: [], tris: [] },
    navRects: [],
  };
}

/**
 * @param flat Flat hull symbol
 */
export function createLayout(
  gmKey: StarShipGeomorphKey,
  flat: Geomorph.FlatSymbol,
  assets: AssetsType,
): Geomorph.Layout {
  debug(`createLayout ${gmKey}`);

  const hullWalls = assets.symbol[gmKey]?.hullWalls;
  if (!hullWalls) {
    error(`Missing hull symbol ${gmKey}: falling back to empty layout`);
    return createEmptyLayout(gmKey, flat);
  }

  const hullPoly = Poly.union(hullWalls).map((x) => x.precision(precision));
  const hullOutline = hullPoly.map((x) => new Poly(x.outline).clone()); // sans holes

  // Avoid non-hull walls inside hull walls (for x-ray)
  const uncutWalls = flat.walls
    .flatMap((x) => Poly.cutOut(hullWalls, [x]).map((y) => ((y.meta = x.meta), y)))
    .concat(hullWalls);
  const plainWallMeta = { wall: true };
  const hullWallMeta = { wall: true, hull: true };

  /**
   * Cut doors from walls pointwise. The latter:
   * - avoids errors (e.g. 301).
   * - permits meta propagation e.g. h (height), hull (hull wall)
   */
  const connectorPolys = flat.doors.concat(flat.windows);
  const cutWalls = uncutWalls.flatMap((x) =>
    Poly.cutOut(connectorPolys, [x]).map((y) =>
      Object.assign(y, {
        meta: specialWallMetaKeys.some((key) => key in x.meta)
          ? x.meta
          : x.meta.hull === true
            ? hullWallMeta
            : plainWallMeta,
      }),
    ),
  );

  const rooms = Poly.union(uncutWalls.concat(flat.windows)).flatMap((x) =>
    x.holes.map((ring) => new Poly(ring).fixOrientation()),
  );

  const decor = flat.decor.map(createLayoutDecorFromPoly);

  const ignoreNavPoints = decor.flatMap((d) => (d.type === "point" && d.meta["ignore-nav"] ? d : []));
  const symbolObstacles = flat.obstacles.filter((d) => d.meta["permit-nav"] !== true);

  const navPolyWithDoors = Poly.cutOut(
    [
      ...cutWalls.flatMap((x) => geomService.createOutset(x, wallOutset)),
      ...flat.windows,
      ...symbolObstacles.flatMap((x) =>
        geomService.createOutset(
          x,
          typeof x.meta["nav-outset"] === "number" ? x.meta["nav-outset"] * sguToWorldScale : obstacleOutset,
        ),
      ),
      // 🚧 in future may cut out non-navigable decor quads
      // ...decor
      //   .filter((d) => d.meta.nav === true)
      //   .map((d) => geomService.createOutset(Poly.fromRect(d.bounds2d), obstacleOutset)[0]),
    ],
    hullOutline,
  )
    .filter((poly) => poly.rect.area > 1 && !ignoreNavPoints.some((p) => poly.contains(p)))
    .map((poly) => poly.cleanFinalReps().precision(precision));

  // 🔔 connector.roomIds will be computed in browser
  const doors = flat.doors.map((x) => new Connector(x));
  const windows = flat.windows.map((x) => new Connector(x));

  // - joining walls with `{plain,hull}WallMeta` reduces the rendering cost later
  // - could save more by joining hull/non-hull but want to distinguish them
  const joinedWalls = Poly.union(cutWalls.filter((x) => x.meta === plainWallMeta)).map((x) =>
    Object.assign(x, { meta: plainWallMeta }),
  );
  const joinedHullWalls = Poly.union(cutWalls.filter((x) => x.meta === hullWallMeta)).map((x) =>
    Object.assign(x, { meta: hullWallMeta }),
  );
  const unjoinedWalls = cutWalls.filter((x) => x.meta !== plainWallMeta && x.meta !== hullWallMeta);

  const obstacles = flat.obstacles.map((o): Geomorph.LayoutObstacle => {
    const origObstacleId = o.meta.origObstacleId as number;
    const symbolKey = o.meta.symKey as StarshipSymbolImageKey;
    const origSymbol = assets.symbol[symbolKey] as Geomorph.Symbol;
    const origPoly = origSymbol.obstacles[o.meta.origObstacleId];
    // o.meta.transform is aggregated in `instantiateFlatSymbol`
    const transform = (o.meta.transform ?? [1, 0, 0, 1, 0, 0]) as Geom.SixTuple;
    tmpMat1.feedFromArray(transform);
    return {
      symbolKey,
      obstacleId: origObstacleId,
      origPoly,
      origSubRect: origPoly.rect.delta(-origSymbol.bounds.x, -origSymbol.bounds.y).precision(2),
      height: typeof o.meta["force-y"] === "number" ? o.meta["force-y"] : typeof o.meta.y === "number" ? o.meta.y : 0,
      transform: tmpMat1.feedFromArray(transform).json,
      center: tmpMat1.transformPoint(origPoly.center).precision(2),
      meta: deepClone(origPoly.meta),
    };
  });
  decor.forEach((d, decorId) => {
    const obstacleId = d.meta.obstacleId;
    if (typeof obstacleId === "number") {
      (obstacles[obstacleId].meta.decorIds ??= []).push(decorId);
    }
  });

  return {
    key: gmKey,
    bounds: flat.bounds,
    num: getGeomorphNumber(gmKey),

    decor,
    // ensure hull doors are 1st
    doors: doors.filter((x) => x.meta.hull).concat(doors.filter((x) => !x.meta.hull)),
    hullPoly,
    obstacles,
    rooms: rooms.map((x) => x.precision(precision)),
    unsorted: flat.unsorted.map((x) => x.precision(precision)),
    walls: [...joinedHullWalls, ...joinedWalls, ...unjoinedWalls].map((x) => x.precision(precision)),
    windows,

    ...decomposeLayoutNav(navPolyWithDoors, doors),
  };
}

/**
 * 🚧 clarify and clean
 * - Script only.
 * - Layout only i.e. not nested symbols.
 * - Should be instantiated inside `<Decor/>`
 */
export function createLayoutDecorFromPoly(poly: Poly): Geomorph.Decor {
  // 🔔 key, meta.{gmId,grKey,roomId} will provided on instantiation
  const meta = Object.assign(poly.meta, { gmId: -1, grKey: "g-1r-1", roomId: -1 } satisfies Geomorph.GmRoomId);
  meta.y = toPrecision(Number(meta.y) || 0);
  const base = { key: "", meta };

  if (meta.rect === true) {
    if (poly.outline.length !== 4) {
      warn(`${"createLayoutDecorFromPoly"}: decor rect expected 4 points (saw ${poly.outline.length})`, poly.meta);
    }
    const { baseRect, angle } = geomService.polyToAngledRect(poly);
    baseRect.precision(precision);
    return {
      type: "rect",
      ...base,
      bounds: poly.rect.precision(3),
      points: poly.outline.map((x) => x.clone().precision(3)),
      center: poly.center.precision(3),
      angle,
    };
  } else if (meta.quad === true) {
    const polyRect = poly.rect.precision(precision);
    const { transform } = poly.meta;
    const quadMeta = { ...base.meta } as Geomorph.DecorQuad["meta"];
    delete quadMeta.transform; // already provided one-level-up

    const center = poly.center.precision(3);
    const { baseRect } = geomService.polyToAngledRect(poly);
    const topCenter = center
      .clone()
      .translate(-(transform[2] * baseRect.height) / 2, -(transform[3] * baseRect.height) / 2)
      .precision(3);

    return {
      type: "quad",
      key: base.key,
      meta: quadMeta,
      bounds: polyRect.clone(),
      transform,
      center,
      topCenter,
      det: Math.sign(transform[0] * transform[3] - transform[1] * transform[2]),
    };
  } else if (meta.circle === true) {
    const polyRect = poly.rect.precision(precision);
    const baseRect = geomService.polyToAngledRect(poly).baseRect.precision(precision);
    const center = poly.center.precision(precision);
    const radius = Math.max(baseRect.width, baseRect.height) / 2;
    return { type: "circle", ...base, bounds: polyRect, radius, center };
  } else {
    // 🔔 fallback to decor point
    const center = poly.center.precision(precision);
    const radius = decorPointDefaultRadius;
    const bounds2d = new Rect(center.x - radius, center.y - radius, 2 * radius, 2 * radius).precision(precision);
    /**
     * meta.direction:
     * - comes from <use transform> of decor symbol
     * - determines orient (degrees), where direction (1, 0) understood as 0 degrees.
     */
    const direction = (meta.direction as Geom.VectJson) || { x: 0, y: 0 };
    delete meta.direction;
    const orient = toPrecision((180 / Math.PI) * Math.atan2(direction.y, direction.x));

    const transform: Geom.SixTuple = meta.transform ?? [1, 0, 0, 1, 0, 0];

    return {
      type: "point",
      ...base,
      bounds: bounds2d,
      x: center.x,
      y: center.y,
      orient,
      transform,
      det: Math.sign(transform[0] * transform[3] - transform[1] * transform[2]),
    };
  }
}

/** Browser only. */
export function createLayoutInstance(
  layout: Geomorph.Layout,
  gmId: number,
  transform: Geom.AffineTransform,
): Geomorph.LayoutInstance {
  const matrix = new Mat(transform);

  // we only support "edge geomorph" or "full geomorph"
  const sguGridRect = new Rect(0, 0, 1200, isEdgeGm(layout.num) ? 600 : 1200);

  return {
    ...layout,
    gmId,
    transform,
    matrix,
    gridRect: sguGridRect.scale(sguToWorldScale).applyMatrix(matrix),
    inverseMatrix: matrix.getInverseMatrix(),
    mat4: embedXZMat4(transform),
    determinant: matrix.determinant,

    decor: layout.decor.map((d, decorId) => instantiateDecor(d, matrix, gmId, decorId)),

    // use refs because we'll add roomIds
    hullDoors: layout.doors.filter((d) => d.meta.hull === true),

    getOtherRoomId(doorId, roomId) {
      // We support case where roomIds are equal e.g. 303
      const { roomIds } = this.doors[doorId];
      return roomIds.find((x, i) => typeof x === "number" && roomIds[1 - i] === roomId) ?? -1;
    },
    isHullDoor(doorId) {
      return doorId < this.hullDoors.length;
    },
  };
}

export function createMapDefFromSavedFile(savedFile: MapEditSavedMap): Geomorph.MapDef {
  type GeomorphNode = SymbolMapNode & { srcKey: StarShipGeomorphKey };
  const geomorphNodes = filterNodes(
    savedFile.nodes,
    (node): node is GeomorphNode => node.type === "symbol" && node.srcKey !== null && isHullSymbolImageKey(node.srcKey),
  );

  return {
    key: savedFile.key,
    gms: geomorphNodes.map((gm) => ({
      gmKey: gm.srcKey,
      transform: {
        ...gm.transform,
        // 🔔 ignoring offset amounts to correcting bounds
        e: toPrecision(gm.transform.e * sguToWorldScale, 6),
        f: toPrecision(gm.transform.f * sguToWorldScale, 6),
      },
    })),
  };
}

export function decomposeLayoutNav(
  navPolyWithDoors: Geom.Poly[],
  doors: Connector[],
): Pick<Geomorph.Layout, "navDecomp" | "navRects"> {
  // // remove all doorways... we'll use offMeshConnections instead
  // const navDoorways = doors.map((x) => x.computeDoorway().precision(precision).cleanFinalReps());
  // const navPolySansDoors = Poly.cutOut(navDoorways, navPolyWithDoors).map((x) => x.cleanFinalReps());
  // const navDecomp = geomService.joinTriangulations(navPolySansDoors.map((poly) => poly.qualityTriangulate()));

  const navDecomp = geomService.joinTriangulations(navPolyWithDoors.map((poly) => poly.qualityTriangulate()));

  // include doors to infer "connected components"
  const navRects = navPolyWithDoors.map((x) => x.rect.precision(precision));
  // Smaller rects 1st, else larger overrides (e.g. 102)
  navRects.sort((a, b) => (a.area < b.area ? -1 : 1));
  // Mutate doors
  doors.forEach((door) => (door.navRectId = navRects.findIndex((r) => r.contains(door.center))));
  return { navDecomp, navRects };
}

function extractDecorPolyFromMapEditNode(node: DecorImageMapNode, meta: Meta): Poly | null {
  const poly = Poly.fromRect({ x: 0, y: 0, ...node.baseRect });
  const mat = tmpMat1.setMatrixValue(node.transform).translate(node.offset.x, node.offset.y).precision(precision);
  poly.applyMatrix(mat);

  poly.meta = meta;
  poly.meta.img = node.srcKey; // e.g. arrow-square-right-duotone

  if (meta.img === "switch") {
    meta.switch = true;
    meta.y = doorSwitchHeight;
    meta.tilt = true; // 90° around "top"
  }

  if (meta.quad === true || meta.point === true) {
    // - preserve transform for shader later, so can transform quad from the spritesheet
    // - physical coords provided by `poly` e.g. for collision detection
    // - during symbol flattening `transformDecorMeta` expects tuple
    // - convert to world coords, matching later `poly` scale
    poly.meta.transform = mat.toArray();
    poly.meta.transform[4] = toPrecision(poly.meta.transform[4] * sguToWorldScale, 4);
    poly.meta.transform[5] = toPrecision(poly.meta.transform[5] * sguToWorldScale, 4);
  }

  if (meta.quad !== true) {
    // 🔔 fallback to point
    meta.point = true;
    meta.direction = tmpVect1.set(mat.a, mat.b).normalize().json;
  }

  return poly;
}

/**
 * - Mutates `flattened`
 * - Returns flattened symbol.
 */
export function flattenSymbol(symbol: Geomorph.Symbol, flattened: AssetsType["flattened"]): Geomorph.FlatSymbol {
  const { key, isHull, walls, obstacles, symbols, unsorted, windows, removableDoors, addableWalls } = symbol;

  const flats = symbols.flatMap(({ symbolKey, meta, transform }) => {
    const flat = flattened[symbolKey];
    if (flat) {
      return instantiateFlatSymbol(flat, meta, transform);
    } else {
      warn(`Missing flattened symbol for key ${symbolKey}`);
      return [];
    }
  });

  const { flatDoors, flatDecor } = computeFlatDoorsDecorObstacles(symbol.key, symbol, flats);

  return (flattened[key] = {
    key,
    isHull,
    bounds: symbol.bounds,
    width: symbol.width,
    height: symbol.height,

    // not aggregated, only cloned
    removableDoors: removableDoors.map((x) => ({ ...x, wall: x.wall.cleanClone() })),
    addableWalls: addableWalls.map((x) => x.cleanClone()),

    // aggregated and cloned
    doors: flatDoors,
    decor: flatDecor,
    obstacles: obstacles.concat(flats.flatMap((x) => x.obstacles)),
    unsorted: unsorted.concat(flats.flatMap((x) => x.unsorted)),
    walls: walls.concat(flats.flatMap((x) => x.walls)),
    windows: windows.concat(flats.flatMap((x) => x.windows)),
  });
}

export function flattenSymbols(symbolsStratified: SymbolGraphNode[][], assets: AssetsType) {
  const flattened: AssetsType["flattened"] = assets.flattened ?? {};
  for (const level of symbolsStratified) {
    for (const { id: symbolKey } of level) {
      const symbol = assets.symbol[symbolKey];
      if (symbol) {
        flattenSymbol(symbol, flattened);
      } else {
        warn(`Symbol ${symbolKey} not found in assets.symbol`);
      }
    }
  }
  assets.flattened = flattened;
}

function instantiateDecor<T extends Geomorph.Decor>(d: T, matrix: Mat, gmId: number, decorId: number): T {
  // decor.key defined in <Decor> once gmRoomId computed
  const bounds = d.bounds.clone().applyMatrix(matrix).precision(precision);
  const meta = { ...d.meta, gmId, decorId } as T["meta"];

  if (typeof meta.doorId === "number") {
    // gmDoorId
    meta.gdKey = `g${gmId}d${meta.doorId}`;
  }

  switch (d.type) {
    case "point": {
      const p = matrix.transformPoint({ x: d.x, y: d.y });
      const orient = toPrecision((180 / Math.PI) * matrix.transformAngle(d.orient * (Math.PI / 180)));
      const groundPoint = { x: toPrecision(p.x), y: toPrecision(p.y) };
      meta.orient = orient; // expose to object-pick
      meta.groundPoint = groundPoint;

      return {
        ...d,
        meta,
        bounds,
        ...groundPoint,
        orient,
      };
    }
    case "quad": {
      const center = matrix.transformPoint({ ...d.center });
      const topCenter = matrix.transformPoint({ ...d.topCenter });
      return {
        ...d,
        meta,
        bounds,
        transform: tmpMat1.setMatrixValue(matrix).preMultiply(d.transform).toArray(),
        center: { x: toPrecision(center.x), y: toPrecision(center.y) },
        topCenter: { x: toPrecision(topCenter.x), y: toPrecision(topCenter.y) },
      };
    }
    case "rect": {
      const center = matrix.transformPoint({ ...d.center });
      return {
        ...d,
        meta,
        bounds,
        points: d.points.map((p) => {
          const q = matrix.transformPoint({ ...p });
          return { x: toPrecision(q.x), y: toPrecision(q.y) };
        }),
        center: { x: toPrecision(center.x), y: toPrecision(center.y) },
        angle: toPrecision((180 / Math.PI) * matrix.transformAngle(d.angle * (Math.PI / 180))),
      };
    }
    case "circle": {
      const center = matrix.transformPoint({ ...d.center });
      return {
        ...d,
        meta,
        bounds,
        center: { x: toPrecision(center.x), y: toPrecision(center.y) },
      };
    }
    default:
      return { ...d, meta };
  }
}

/**
 * - aggregates obstacle transform as meta.transform
 * - supports removable doors
 * - supports addable walls
 */
export function instantiateFlatSymbol(
  sym: Geomorph.FlatSymbol,
  meta: Meta<{ doors?: string[]; walls?: string[] }>,
  transform: Geom.AffineTransform,
): Geomorph.FlatSymbol {
  const mat = tmpMat1.setMatrixValue(transform);
  const det = Math.round(mat.determinant); // -1 or +1

  /** e.g. `['s']` means only permit 'optional'-tagged doors with tag 's' */
  const doorTags = meta.doors as string[] | undefined;
  const doorsToRemove =
    doorTags === undefined
      ? []
      : sym.removableDoors.filter(({ doorId }) => {
          const { meta } = sym.doors[doorId];
          return !doorTags.some((tag) => meta[tag] === true);
        });

  /** e.g. `['s']` means add any wall tagged with 'optional' and 's' */
  const wallTags = meta.walls as string[] | undefined;
  const wallsToAdd = ([] as Geom.Poly[]).concat(
    doorsToRemove.map((x) => x.wall),
    wallTags === undefined ? [] : sym.addableWalls.filter(({ meta }) => wallTags.some((x) => meta[x] === true)),
  );

  const doorIdsToRemove = new Set(doorsToRemove.map((x) => x.doorId));
  const doorIdRemap = new Map<number, number>();
  let newDoorId = 0;
  for (let i = 0; i < sym.doors.length; i++) {
    if (!doorIdsToRemove.has(i)) doorIdRemap.set(i, newDoorId++);
  }

  const decor = sym.decor.flatMap((d) => {
    if (typeof d.meta.doorId === "number") {
      if (doorIdsToRemove.has(d.meta.doorId)) return [];
      return d.cleanClone(mat, {
        ...transformDecorMeta(d.meta, mat, meta.y),
        doorId: doorIdRemap.get(d.meta.doorId),
      });
    }
    return d.cleanClone(mat, transformDecorMeta(d.meta, mat, meta.y));
  });

  return {
    key: sym.key,
    isHull: sym.isHull,
    width: sym.width,
    height: sym.height,
    bounds: sym.bounds,
    decor,
    doors: sym.doors
      .filter((_, doorId) => !doorIdsToRemove.has(doorId))
      .map((poly) => {
        const sd = poly.meta.slide;
        if (!Array.isArray(sd)) return poly.cleanClone(mat);
        // transform meta.slide
        const v = mat.transformSansTranslate(tmpVect1.set(sd[0], sd[1]));
        return poly.cleanClone(mat, { slide: [v.x, v.y], det: det * (poly.meta.det ?? +1) });
      }),
    obstacles: sym.obstacles.map((poly) =>
      poly.cleanClone(mat, {
        // aggregate height from MapEdit symbols
        ...(typeof meta.y === "number" && {
          y: toPrecision(meta.y + (parseFloat(poly.meta.y) || 0)),
        }),
        // - we compute transform during symbol flattening
        // - this is the only place we set `meta.transform` for obstacles
        // - later used to define `GeomorphLayoutObstacle` for layout obstacles
        ...{
          transform: tmpMat2
            .setMatrixValue(transform)
            .preMultiply(poly.meta.transform ?? [1, 0, 0, 1, 0, 0])
            // .preMultiply([1, 0, 0, 1, -poly.center.x, -poly.center.y])
            // .postMultiply([1, 0, 0, 1, poly.center.x, poly.center.y])
            .toArray(),
        },
      }),
    ),
    unsorted: sym.unsorted.map((poly) => poly.cleanClone(mat)),
    walls: sym.walls.concat(wallsToAdd).map((poly) => poly.cleanClone(tmpMat1)),
    windows: sym.windows.map((poly) => poly.cleanClone(tmpMat1)),

    // not aggregated
    removableDoors: [],
    addableWalls: [],
  };
}

export function isEdgeGm(input: StarShipGeomorphKey | StarshipGeomorphNumber) {
  if (typeof input !== "number") {
    input = getGeomorphNumber(input);
  }
  return 301 <= input && input < 500;
}

/**
 * - Convert a MapEdit saved symbol into a `Geomorph.Symbol`.
 * - Previously known as `parseSymbol`.
 */
export function parseSymbolFromSavedFile(savedFile: MapEditSavedSymbol): Geomorph.Symbol {
  const allNodes = filterNodes(savedFile.nodes, (_node: MapNode): _node is MapNode => true);

  const symbols = [] as Geomorph.Symbol["symbols"];

  type ParsePolysKey = Exclude<SymbolPolysKey, "removableDoors" | "addableWalls">;

  const polysLookup: Record<ParsePolysKey, Geomorph.Symbol[ParsePolysKey]> = {
    decor: [] as Geomorph.Symbol["decor"],
    doors: [] as Geomorph.Symbol["doors"],
    hullWalls: [] as Geomorph.Symbol["hullWalls"],
    obstacles: [] as Geomorph.Symbol["obstacles"],
    unsorted: [] as Geomorph.Symbol["unsorted"],
    walls: [] as Geomorph.Symbol["walls"],
    windows: [] as Geomorph.Symbol["windows"],
  };

  let roomLabel = undefined as string | undefined;

  for (const node of allNodes) {
    const ownTags = textToTags(node.name);
    const meta = tagsToMeta(ownTags);

    if (node.type === "symbol") {
      node.srcKey !== null &&
        symbols.push({
          symbolKey: node.srcKey,
          width: node.baseRect.width,
          height: node.baseRect.height,
          // 🔔 symbol geometry is already offset
          transform: { ...node.transform },
          meta,
        });
      continue;
    }

    const poly = convertMapEditNodeToPoly(node, meta)?.precision(precision).cleanFinalReps().fixOrientation() ?? null;
    if (poly === null) continue;

    if (meta.wall === true) {
      polysLookup.walls.push(poly);
    } else if (meta.door === true) {
      roomLabel !== undefined && (poly.meta.label = roomLabel);
      polysLookup.doors.push(poly);
    } else if (meta.obstacle === true) {
      polysLookup.obstacles.push(poly);
    } else if (meta.decor === true) {
      polysLookup.decor.push(poly);
    } else if (meta.window === true) {
      polysLookup.windows.push(poly);
    } else {
      polysLookup.unsorted.push(poly);
    }

    if (meta.wall === true && meta.hull === true) {
      polysLookup.hullWalls.push(poly);
    }

    if (meta.switch === true) {
      // switches are aligned to doors
      meta.doorId = polysLookup.doors.length - 1;
    }

    if (meta.decor === true) {
      if (meta.on === true) {
        // decor can be "on" last obstacle
        const obstacleId = polysLookup.obstacles.length - 1;
        if (obstacleId >= 0) {
          meta.obstacleId = obstacleId;
        }
      }
      roomLabel = typeof meta.label === "string" ? meta.label : roomLabel;
    }

    if (meta.obstacle === true) {
      // link to original symbol
      meta.symKey = savedFile.key;
      // local id inside SVG symbol
      meta.origObstacleId = polysLookup.obstacles.length - 1;
      if (typeof meta.inset === "number") {
        // convert inset to world coords
        meta.inset = toPrecision(meta.inset * sguToWorldScale, 6);
      }
    }
  }

  // sgu -> world scale, noting hullWalls repeated in walls
  const s = sguToWorldScale;
  const scaled = new Set<Geom.Poly>();
  for (const polys of Object.values(polysLookup))
    for (const p of polys) {
      !scaled.has(p) && scaled.add(p.scale(s).precision(6));
    }

  return {
    key: savedFile.key,
    isHull: isHullSymbolImageKey(savedFile.key),
    width: toPrecision(savedFile.width * s, 6),
    height: toPrecision(savedFile.height * s, 6),
    bounds: savedFile.bounds.clone().scale(s).precision(6),

    ...polysLookup,

    removableDoors: polysLookup.doors.flatMap((doorPoly, doorId) =>
      doorPoly.meta.optional ? { doorId, wall: Poly.intersect([doorPoly], polysLookup.walls)[0] } : [],
    ),
    addableWalls: polysLookup.walls.filter((x) => x.meta.optional === true),

    symbols: symbols.map((sym) => ({
      ...sym,
      width: toPrecision(sym.width * s, 6),
      height: toPrecision(sym.height * s, 6),
      transform: {
        ...sym.transform,
        e: toPrecision(sym.transform.e * s, 6),
        f: toPrecision(sym.transform.f * s, 6),
      },
    })),
  };
}

/**
 * For nested symbols i.e. before decor becomes `Geomorph.Decor`
 */
export function transformDecorMeta(meta: Meta, mat: Mat, y?: number): Meta {
  /** if `y=0` place decor "on the ground" otherwise aggregate `y` */
  const nextY = meta.y === 0 ? 0.01 : (parseFloat(String(y)) || 0) + (parseFloat(String(meta.y)) || 0.01);
  const nextH = meta.h;

  return {
    ...meta,
    y: nextY,
    h: nextH,
    ...(Array.isArray(meta.transform) && {
      transform: tmpMat2
        .setMatrixValue(mat)
        // 🔔 meta.transform should be tuple representation of decor image node's transform
        .preMultiply(meta.transform as Geom.SixTuple)
        .toArray(),
    }),
    ...(meta.direction !== undefined && {
      direction: mat.transformSansTranslate({ ...meta.direction }),
    }),
  };
}

const tmpMat1 = new Mat();
const tmpMat2 = new Mat();
const tmpVect1 = new Vect();
