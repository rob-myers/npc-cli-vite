import {
  getGeomorphNumber,
  isHullSymbolImageKey,
  type StarShipGeomorphKey,
  type StarshipGeomorphNumber,
  type StarshipSymbolImageKey,
} from "@npc-cli/media/starship-symbol";
import "@npc-cli/ui__world/geomorph.d.ts";
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
import { geomService, Mat, Poly, Rect, Vect } from "@npc-cli/util/geom";
import { debug, tagsToMeta, textToTags, toPrecision, warn } from "@npc-cli/util/legacy/generic";
import {
  decorIconRadius,
  decorIconRadiusOutset,
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
 * 🚧 needs review
 *
 * Compute flattened doors and decor:
 * - ensure decor `switch={doorId}` points to correct `doorId`
 * - when doors are close (e.g. coincide) remove later door
 * - ensure resp. switches removed, set other two as "inner"
 */
function computeFlatDoorsAndDecor(
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

    getOtherRoomId(_doorId, _roomId) {
      // // We support case where roomIds are equal e.g. 303
      // const { roomIds } = this.doors[doorId];
      // return roomIds.find((x, i) => typeof x === "number" && roomIds[1 - i] === roomId) ?? -1;
      return -1;
    },
    isHullDoor(_doorId) {
      // return doorId < this.hullDoors.length;
      return false;
    },
  };
}

function createEmptyLayout(gmKey: StarShipGeomorphKey, flat: Geomorph.FlatSymbol): Geomorph.Layout {
  return {
    key: gmKey,
    bounds: flat.bounds,
    num: getGeomorphNumber(gmKey),

    decor: [],
    doors: [],
    hullDoors: [],
    hullPoly: [],
    labels: [],
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
    warn(`Missing hull symbol ${gmKey}: falling back to empty layout`);
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
   * - avoids errors (e.g. for 301).
   * - permits meta propagation e.g. `h` (height), 'hull' (hull wall)
   */
  const connectors = flat.doors.concat(flat.windows);
  const cutWalls = uncutWalls.flatMap((x) =>
    Poly.cutOut(connectors, [x]).map((y) =>
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

  // 🔔 Room meta is specified by:
  // - "decor meta ..."
  // - "decor label=text ..."
  // could compute faster client-side via pixel-look-up
  const metaDecor = new Set(flat.decor.filter((x) => typeof x.meta.label === "string" || x.meta.meta === true));
  for (const room of rooms) {
    for (const d of metaDecor) {
      if (room.contains(d.outline[0])) {
        metaDecor.delete(d); // at most 1 room
        Object.assign(room.meta, d.meta, {
          decor: undefined,
          meta: undefined,
          y: undefined,
          label: room.meta.label ?? d.meta.label, // 1st label has priority
        });
      }
    }
  }

  const decor: Geomorph.Decor[] = [];
  const labels: Geomorph.DecorPoint[] = [];
  for (const poly of flat.decor) {
    const d = createLayoutDecorFromPoly(poly);
    if (typeof poly.meta.label === "string" && d.type === "point") {
      labels.push(d);
    } else {
      decor.push(d);
    }
  }

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
      ...decor
        .filter(isDecorCuboid)
        .filter((d) => d.meta.nav === true)
        // 🔔 originally all decor was a <use> of a unit-quad
        // .map((d) => geomService.applyUnitQuadTransformWithOutset(tmpMat1.feedFromArray(d.transform), obstacleOutset)),
        .map((d) => geomService.createOutset(Poly.fromRect(d.bounds2d), obstacleOutset)[0]),
    ],
    hullOutline,
  )
    .filter((poly) => poly.rect.area > 1 && !ignoreNavPoints.some((p) => poly.contains(p)))
    .map((poly) => poly.cleanFinalReps().precision(precision));

  // 🔔 connector.roomIds will be computed in browser
  const doors = flat.doors.map((x) => new Connector(x));
  const windows = flat.windows.map((x) => new Connector(x));

  // Joining walls with `{plain,hull}WallMeta` reduces the rendering cost later
  // 🔔 could save more by joining hull/non-hull but want to distinguish them
  const joinedWalls = Poly.union(cutWalls.filter((x) => x.meta === plainWallMeta)).map((x) =>
    Object.assign(x, { meta: plainWallMeta }),
  );
  const joinedHullWalls = Poly.union(cutWalls.filter((x) => x.meta === hullWallMeta)).map((x) =>
    Object.assign(x, { meta: hullWallMeta }),
  );
  const unjoinedWalls = cutWalls.filter((x) => x.meta !== plainWallMeta && x.meta !== hullWallMeta);

  return {
    key: gmKey,
    bounds: flat.bounds,
    num: getGeomorphNumber(gmKey),

    decor,
    doors,
    hullDoors: doors.filter((x) => x.meta.hull),
    hullPoly,
    labels,
    obstacles: flat.obstacles.map((o): Geomorph.LayoutObstacle => {
      const obstacleId = o.meta.obsId as number;
      const symbolKey = o.meta.symKey as StarshipSymbolImageKey;
      const origSymbol = assets.symbol[symbolKey] as Geomorph.Symbol;
      const origPoly = origSymbol.obstacles[o.meta.obsId];
      // o.meta.transform is aggregated in `instantiateFlatSymbol`
      const transform = (o.meta.transform ?? [1, 0, 0, 1, 0, 0]) as Geom.SixTuple;
      tmpMat1.feedFromArray(transform);
      return {
        symbolKey,
        obstacleId,
        origPoly,
        origSubRect: origPoly.rect.delta(-origSymbol.bounds.x, -origSymbol.bounds.y).precision(2),
        height: typeof o.meta.y === "number" ? o.meta.y : 0,
        transform: tmpMat1.feedFromArray(transform).json,
        center: tmpMat1.transformPoint(origPoly.center).precision(2),
        meta: origPoly.meta,
      };
    }),
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
  // 🔔 key, gmId, roomId provided on instantiation
  const meta = poly.meta as Meta<Geomorph.GmRoomId>;
  meta.y = toPrecision(Number(meta.y) || 0);
  const base = { key: "", meta };

  if (meta.rect === true) {
    if (poly.outline.length !== 4) {
      warn(`createLayoutDecorFromPoly: decor rect expected 4 points (saw ${poly.outline.length})`, poly.meta);
    }
    const { baseRect, angle } = geomService.polyToAngledRect(poly);
    baseRect.precision(precision);
    return {
      type: "rect",
      ...base,
      bounds2d: poly.rect.json,
      points: poly.outline.map((x) => x.json),
      center: poly.center.precision(3).json,
      angle,
    } as Geomorph.DecorRect;
  } else if (meta.quad === true || meta.decal === true) {
    const type = meta.quad === true ? "quad" : "decal"; // decal supported?
    const polyRect = poly.rect.precision(precision);
    const { transform } = poly.meta;
    delete poly.meta.transform; // ?

    const quadMeta = base.meta as Geomorph.DecorQuad["meta"];
    if (!isDecorImgKey(quadMeta.img)) {
      quadMeta.img = "icon--warn";
    }

    return {
      type: type as "quad" | "decal",
      key: base.key,
      meta: quadMeta,
      bounds2d: polyRect.json,
      transform,
      center: poly.center.precision(3).json,
      // 🔔 determinant `det` will be provided on instantiation
      det: 1,
    } as Geomorph.DecorQuad | Geomorph.DecorDecal;
  } else if (meta.cuboid === true) {
    // decor cuboids follow "decor quad approach"
    const polyRect = poly.rect.precision(precision);
    const { transform } = poly.meta;
    delete poly.meta.transform;

    const center2d = poly.center;
    const y3d = typeof meta.y === "number" ? meta.y : 0;
    const height3d = typeof meta.h === "number" ? meta.h : 0.5; // 🚧 remove hard-coding
    const center = geomService.toPrecisionV3({ x: center2d.x, y: y3d + height3d / 2, z: center2d.y });

    return { type: "cuboid", ...base, bounds2d: polyRect.json, transform, center } as Geomorph.DecorCuboid;
  } else if (meta.circle === true) {
    const polyRect = poly.rect.precision(precision);
    const baseRect = geomService.polyToAngledRect(poly).baseRect.precision(precision);
    const center = poly.center.precision(precision);
    const radius = Math.max(baseRect.width, baseRect.height) / 2;
    return { type: "circle", ...base, bounds2d: polyRect.json, radius, center } as Geomorph.DecorCircle;
  } else {
    // 🔔 fallback to decor point
    const center = poly.center.precision(precision);
    const radius = decorIconRadius + decorIconRadiusOutset;
    const bounds2d = new Rect(center.x - radius, center.y - radius, 2 * radius, 2 * radius).precision(precision).json;
    /**
     * meta.direction:
     * - comes from <use transform> of decor symbol
     * - determines orient (degrees), where direction (1, 0) understood as 0 degrees.
     */
    const direction = (meta.direction as Geom.VectJson) || { x: 0, y: 0 };
    delete meta.direction;
    const orient = toPrecision((180 / Math.PI) * Math.atan2(direction.y, direction.x));

    // permit invisible point i.e. no image
    if ("img" in meta && !isDecorImgKey(meta.img)) {
      meta.img = "icon--warn";
    }
    return { type: "point", ...base, bounds2d, x: center.x, y: center.y, orient } as Geomorph.DecorPoint;
  }
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

/**
 * Convert a MapEdit saved symbol into a `Geomorph.Symbol`.
 */
export function createSymbolFromSavedFile(savedFile: MapEditSavedSymbol): Geomorph.Symbol {
  const allNodes = filterNodes(savedFile.nodes, (_node: MapNode): _node is MapNode => true);

  const symbols = [] as Geomorph.Symbol["symbols"];

  const polysLookup: Record<SymbolPolysKey, Geomorph.Symbol[SymbolPolysKey]> = {
    decor: [] as Geomorph.Symbol["decor"],
    doors: [] as Geomorph.Symbol["doors"],
    hullWalls: [] as Geomorph.Symbol["hullWalls"],
    obstacles: [] as Geomorph.Symbol["obstacles"],
    unsorted: [] as Geomorph.Symbol["unsorted"],
    walls: [] as Geomorph.Symbol["walls"],
    windows: [] as Geomorph.Symbol["windows"],
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
          // 🔔 symbol geometry is already offset
          transform: { ...node.transform },
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

  const s = sguToWorldScale;
  /** Avoid scaling `hullWalls` twice since also in `walls` */
  const scaled = new Set<Geom.Poly>();
  for (const polys of Object.values(polysLookup)) {
    for (const p of polys)
      if (!scaled.has(p)) {
        p.scale(s).precision(6);
        scaled.add(p);
      }
  }
  return {
    key: savedFile.key,
    isHull: isHullSymbolImageKey(savedFile.key),
    width: toPrecision(savedFile.width * s, 6),
    height: toPrecision(savedFile.height * s, 6),
    bounds: savedFile.bounds.clone().scale(s).precision(6),

    ...polysLookup,
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

function extractDecorPoly(node: DecorImageMapNode, meta: Meta): Poly | null {
  const poly = Poly.fromRect({ x: 0, y: 0, ...node.baseRect });
  const mat = tmpMat1.setMatrixValue(node.transform).translate(node.offset.x, node.offset.y).precision(precision);
  poly.applyMatrix(mat);

  poly.meta = meta;
  poly.meta.img = node.srcKey; // e.g. arrow-square-right-duotone

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

  // extensions
  if (typeof meta.switch === "number") {
    meta.y = doorSwitchHeight;
    meta.tilt = true; // 90° so in XY plane
  }

  return poly;
}

/**
 * - Mutates `flattened`
 * - Returns flattened symbol.
 */
export function flattenSymbol(symbol: Geomorph.Symbol, flattened: AssetsType["flattened"]): Geomorph.FlatSymbol {
  const { key, isHull, walls, obstacles, symbols, unsorted, windows } = symbol;

  const flats = symbols.flatMap(({ symbolKey, meta, transform }) => {
    const flat = flattened[symbolKey];
    if (flat) {
      return instantiateFlatSymbol(flat, meta, transform);
    } else {
      warn(`Missing flattened symbol for key ${symbolKey}`);
      return [];
    }
  });

  const { flatDoors, flatDecor } = computeFlatDoorsAndDecor(symbol.key, symbol, flats);

  return (flattened[key] = {
    key,
    isHull,
    bounds: symbol.bounds,
    width: symbol.width,
    height: symbol.height,

    // 🚧 aggregated and cloned
    // addableWalls: addableWalls.map(x => x.cleanClone()),
    // removableDoors: removableDoors.map(x => ({ ...x, wall: x.wall.cleanClone() })),

    // not aggregated, only cloned
    doors: flatDoors,
    decor: flatDecor,
    obstacles: obstacles.concat(flats.flatMap((x) => x.obstacles)),
    unsorted: unsorted.concat(flats.flatMap((x) => x.unsorted)),
    walls: walls.concat(flats.flatMap((x) => x.walls)),
    windows: windows.concat(flats.flatMap((x) => x.windows)),
  });
}

/**
 * 🚧 support removable doors/walls
 * - aggregates obstacle transform as meta.transform
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
    doors: sym.doors.map((poly) => {
      const sd = poly.meta.slideDirection;
      if (!Array.isArray(sd)) return poly.cleanClone(mat);
      const v = mat.transformSansTranslate(tmpVect1.set(sd[0], sd[1]));
      return poly.cleanClone(mat, { slideDirection: [v.x, v.y] });
    }),
    obstacles: sym.obstacles.map((poly) =>
      poly.cleanClone(mat, {
        // aggregate height from MapEdit symbols
        ...(typeof meta.y === "number" && {
          y: toPrecision(meta.y + (parseInt(poly.meta.y, 10) || 0)),
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
    walls: sym.walls.map((poly) => poly.cleanClone(tmpMat1)),
    windows: sym.windows.map((poly) => poly.cleanClone(tmpMat1)),
  };
}

function isDecorCuboid(d: Geomorph.Decor): d is Geomorph.DecorCuboid {
  return d.type === "cuboid";
}

/** 🚧 somehow check public/decor/manifest.json */
function isDecorImgKey(_input: string) {
  // biome-ignore lint/correctness/noConstantCondition: unimplemented
  if (false) {
    warn(`${"createLayoutDecorFromPoly"}: decor meta.img must exist (using "icon--warn")`);
    return false;
  } else {
    return true;
  }
}

export function isEdgeGm(input: StarShipGeomorphKey | StarshipGeomorphNumber) {
  if (typeof input !== "number") {
    input = getGeomorphNumber(input);
  }
  return 301 <= input && input < 500;
}

function mapNodeToPoly(node: MapNode, meta: Meta): Poly | null {
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
        return extractDecorPoly(node, meta); // meta already attached
      }
      break;
    }
  }

  return null;
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
