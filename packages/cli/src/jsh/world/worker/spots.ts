import { type Spot, SpotsFileSchema } from "@npc-cli/ui__world/spot.schema";
import { inSight } from "@npc-cli/ui__world/worker/nav";
import { fetchParsed, getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";

/**
 * The map's spots, worker-side: each geomorph's under a map-wide key `g{gmId}s{id}` and in world coords,
 * indexed by room and by grid cell. Fetched afresh by each `jsh-setup` that changes them — see `docs/spots.md`
 */
export function setupSpots(msg: { mapKey: string; gms: WW.GmForSpots[]; spotsRev: number }) {
  const cacheKey = `${msg.mapKey} ${JSON.stringify(msg.gms)} ${msg.spotsRev}`;
  if (current?.cacheKey !== cacheKey) current = { cacheKey, promise: createMapSpots(msg.gms) };
}

/** The spots of the map last set up */
export function getSpots(): Promise<MapSpots> {
  if (current === null) throw Error("no spots set up");
  return current.promise;
}

let current: null | { cacheKey: string; promise: Promise<MapSpots> } = null;

/** Answers each query of a batch in order. One that fails answers `{ error }`, not the batch */
export function answerSpotQueries(all: MapSpots, { npcs, openDoors, queries }: Extract<WW.JshOp, { key: "spots" }>) {
  const open = new Set(openDoors);
  /** Spot `a` sees spot `b` as the doors stand */
  const sees = (a: MapSpot, b: MapSpot) => all.sees(a, b) || open.has(all.seesVia(a, b) ?? "");
  /** Where `ref` looks from: an npc's own point, else a spot's */
  const eyeOf = (ref: string): Geom.VectJson => npcByKey.get(ref)?.point ?? resolve(ref);
  /** Some of a body at `b` is in sight from `a`: a ray to its centre or either side, as the doors stand */
  const eyeSees = (a: Geom.VectJson, b: Geom.VectJson) => {
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const [px, py] = [(-dy * bodyRadius) / (Math.hypot(dx, dy) || 1), (dx * bodyRadius) / (Math.hypot(dx, dy) || 1)];
    return [0, 1, -1].some((k) => inSight(a, { x: b.x + k * px, y: b.y + k * py }, open));
  };
  const npcByKey = new Map(npcs.map((npc) => [npc.key, npc]));
  const resolveNpc = (key: string) => {
    const npc = npcByKey.get(key);
    if (npc === undefined) throw Error(`${key}: not sent`);
    return npc;
  };
  /** A spot key, else the spot an npc is nearest */
  const resolve = (ref: string) => {
    const npc = npcByKey.get(ref);
    const spot = spotKeyRe.test(ref) ? all.get(ref) : npc && all.spotOf(npc.key, npc.point, npc.grKeys[0] ?? null);
    if (spot === undefined) throw Error(`${ref}: no spot`);
    return spot;
  };
  /** A spot key, else every spot an npc is at */
  const resolveAll = (ref: string) => {
    const npc = npcByKey.get(ref);
    const spots = npc === undefined ? [resolve(ref)] : all.spotsOf(npc);
    if (spots.length === 0) throw Error(`${ref}: no spot`);
    return spots;
  };
  /** The spots in `rooms`, else every one */
  const inRooms = (rooms: undefined | string[]) => (rooms === undefined ? [...all.byKey.values()] : all.inRooms(rooms));
  return queries.map((query): WW.SpotAnswer => {
    try {
      switch (query.q) {
        case "of":
          return query.all === true ? resolveAll(query.npc).map(toJson) : toJson(resolve(query.npc));
        case "get":
          return toJson(resolve(query.key));
        case "list": {
          let found = inRooms(query.rooms);
          if (query.kinds !== undefined) found = found.filter((s) => query.kinds?.includes(s.kind));
          if (query.near !== undefined) {
            const npc = npcByKey.get(query.near.npc);
            if (npc === undefined) throw Error(`${query.near.npc}: not sent`);
            const keep = new Set(found);
            found = all.near(npc.point, query.near.within).filter((s) => keep.has(s));
          }
          return found.map(toJson);
        }
        case "sees": {
          const [a, b] = [resolve(query.a), resolve(query.b)];
          const npcs = npcByKey.has(query.a) || npcByKey.has(query.b);
          return {
            sees: npcs ? eyeSees(eyeOf(query.a), eyeOf(query.b)) : sees(a, b),
            via: all.seesVia(a, b),
            crouchHides: all.crouchHidden(b, a),
            from: a.key,
            to: b.key,
          };
        }
        case "seenBy":
          return [...new Set(resolveAll(query.a).flatMap((a) => all.seenBy(a)))].map(toJson);
        case "at": {
          const spot = all.nearestTo(query.point, query.grKey);
          return spot === undefined ? null : toJson(spot);
        }
        case "hide": {
          const npc = resolveNpc(query.npc);
          const watchers = query.from.map(eyeOf);
          const exclude = new Set(query.exclude);
          const prefer = query.prefer ?? [];
          const rank = (s: MapSpot) => (prefer.includes(s.kind) ? prefer.indexOf(s.kind) : prefer.length);
          const { away = 0 } = query;
          const isFar = (s: MapSpot) => watchers.every((w) => dist(s, w) >= away);
          const isUnseen = (s: MapSpot) => !watchers.some((w) => eyeSees(w, s));
          // best first, so sight is tested only until one passes: a far one, else a near one
          const ordered = inRooms(query.rooms)
            .filter((s) => placeKinds.includes(s.kind) && !exclude.has(s.key))
            .sort((u, v) => rank(u) - rank(v) || dist(u, npc.point) - dist(v, npc.point));
          const best = ordered.find((s) => isFar(s) && isUnseen(s)) ?? ordered.find((s) => !isFar(s) && isUnseen(s));
          return best === undefined ? null : toJson(best);
        }
        case "makeWay": {
          const npc = resolveNpc(query.npc);
          const [walker, ...corners] = query.path;
          const legs = corners.map((b, i) => [query.path[i], b] as const);
          const best = all
            .near(npc.point, makeWay.within)
            .find(
              (s) =>
                placeKinds.includes(s.kind) &&
                (npc.grKeys.length === 0 || (s.grKey !== null && npc.grKeys.includes(s.grKey))) &&
                legs.every(([a, b]) => distToSeg(s, a, b) >= makeWay.clear) &&
                query.others.every((p) => dist(s, p) >= makeWay.clear) &&
                distToSeg(walker, npc.point, s) >= makeWay.pass,
            );
          return best === undefined ? null : toJson(best);
        }
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
}

async function createMapSpots(gms: WW.GmForSpots[]) {
  const gmKeys = [...new Set(gms.map((gm) => gm.key))];
  // a geomorph without a file has no spots, e.g. a playground, edited at runtime
  const files = await Promise.all(
    gmKeys.map((gmKey) =>
      fetchParsed(`/spot/${gmKey}.json${getDevCacheBustQueryParam()}`, SpotsFileSchema).catch(() => null),
    ),
  );
  const byGmKey = Object.fromEntries(files.flatMap((file) => (file === null ? [] : [[file.gmKey, file]])));
  const spots: MapSpot[] = gms.flatMap((gm, gmId) => {
    const { a, b, c, d, e, f } = gm.transform;
    /** A local angle, as world radians */
    const turn = (angle: number) =>
      Math.atan2(b * Math.cos(angle) + d * Math.sin(angle), a * Math.cos(angle) + c * Math.sin(angle));
    return (byGmKey[gm.key]?.spots ?? []).map((spot) => ({
      key: `g${gmId}s${spot.id}`,
      gmId,
      kind: spot.kind,
      x: a * spot.x + c * spot.y + e,
      y: b * spot.x + d * spot.y + f,
      grKey: spot.roomId === null ? null : `g${gmId}r${spot.roomId}`,
      facing: spot.facing === undefined ? undefined : turn(spot.facing),
      wall: turn((2 * Math.PI * spot.depth.indexOf(Math.min(...spot.depth))) / spot.depth.length),
      spot,
    }));
  });
  return new MapSpots(spots);
}

function toJson({ key, kind, x, y, grKey, facing, wall, spot }: MapSpot): WW.SpotJson {
  return {
    key,
    kind,
    x: round(x),
    y: round(y),
    grKey,
    ...(facing === undefined ? {} : { facing: round(facing) }),
    wall: round(wall),
    sees: spot.sees.length,
  };
}

const round = (x: number) => Math.round(x * 100) / 100;
/** Metres either side of a body's centre that sight is tested to */
const bodyRadius = 0.25;
/** Spots an npc is sent to: not a doable, which needs its decor, nor in a doorway */
const placeKinds = ["cover", "corner", "wall", "fill", "decor"];
/** Metres: making way, a spot this near the blocker, this clear of the walker's path and others, not passing within `pass` of the walker */
const makeWay = { within: 2, clear: 0.6, pass: 0.4 };
const spotKeyRe = /^g\d+s\d+$/;

export class MapSpots {
  byKey = new Map<string, MapSpot>();
  byRoom = new Map<string, MapSpot[]>();
  byCell = new Map<string, MapSpot[]>();

  constructor(spots: MapSpot[]) {
    for (const s of spots) {
      this.byKey.set(s.key, s);
      if (s.grKey !== null) push(this.byRoom, s.grKey, s);
      push(this.byCell, cellKey(s.x, s.y), s);
    }
  }

  /** Each npc's spot last found, kept whilst it is certainly still the nearest */
  lastSpotOf = new Map<string, MapSpot>();
  /** By spot key: half the distance to its room's next nearest spot. Anyone that near it is nearest it */
  halfGapOf = new Map<string, number>();

  get(key: string) {
    return this.byKey.get(key);
  }

  /** The spot npc `npcKey` at `p` is at: their last, if still nearest, else found afresh */
  spotOf(npcKey: string, p: Geom.VectJson, grKey?: null | string) {
    const last = this.lastSpotOf.get(npcKey);
    if (last !== undefined && last.grKey === grKey && dist(last, p) <= this.halfGap(last)) return last;
    const spot = this.nearestTo(p, grKey);
    // off any room it is found afresh: the reach, not the room, decides it
    if (spot === undefined || grKey == null) this.lastSpotOf.delete(npcKey);
    else this.lastSpotOf.set(npcKey, spot);
    return spot;
  }

  /** Every spot `npc` is at: in each of their rooms, those within `ownReach`, else the nearest */
  spotsOf({ point, grKeys }: WW.SpotNpc) {
    const close = this.near(point, ownReach);
    return (grKeys.length > 0 ? grKeys : [null]).flatMap((grKey) => {
      const own = close.filter((s) => s.grKey === grKey);
      return own.length > 0 ? own : (this.nearestTo(point, grKey) ?? []);
    });
  }

  /** Infinite for a room's only spot: anywhere in that room is nearest it */
  halfGap(s: MapSpot) {
    let half = this.halfGapOf.get(s.key);
    if (half === undefined) {
      const others = s.grKey === null ? [] : (this.byRoom.get(s.grKey) ?? []);
      half = others.reduce((min, t) => (t === s ? min : Math.min(min, dist(s, t) / 2)), Infinity);
      this.halfGapOf.set(s.key, half);
    }
    return half;
  }

  /** In any of these rooms */
  inRooms(grKeys: string[]) {
    return grKeys.flatMap((grKey) => this.byRoom.get(grKey) ?? []);
  }

  /** Within `r` metres of `p`, nearest first */
  near(p: Geom.VectJson, r: number) {
    const found: MapSpot[] = [];
    const [cx, cy, n] = [Math.floor(p.x / cellSize), Math.floor(p.y / cellSize), Math.ceil(r / cellSize)];
    for (let i = cx - n; i <= cx + n; i++) {
      for (let j = cy - n; j <= cy + n; j++) {
        for (const s of this.byCell.get(`${i},${j}`) ?? []) if (dist(s, p) <= r) found.push(s);
      }
    }
    return found.sort((u, v) => dist(u, p) - dist(v, p));
  }

  /** The spot nearest `p` in room `grKey`, else nearest within `spotOfReach` */
  nearestTo(p: Geom.VectJson, grKey?: null | string) {
    if (grKey == null || this.byRoom.has(grKey) === false) return this.near(p, spotOfReach)[0];
    const [cx, cy] = [Math.floor(p.x / cellSize), Math.floor(p.y / cellSize)];
    let best: undefined | MapSpot;
    let bestDist = Infinity;
    // ring by ring outwards, until no cell of the next ring can be nearer than the best found
    for (let k = 0; k <= maxRings && (k - 1) * cellSize <= bestDist; k++) {
      for (let i = cx - k; i <= cx + k; i++) {
        for (let j = cy - k; j <= cy + k; j++) {
          if (Math.max(Math.abs(i - cx), Math.abs(j - cy)) !== k) continue; // on the ring only
          for (const s of this.byCell.get(`${i},${j}`) ?? []) {
            const d = dist(s, p);
            if (s.grKey === grKey && d < bestDist) [best, bestDist] = [s, d];
          }
        }
      }
    }
    return best;
  }

  /** `a` sees `b`, doors shut. Only within a geomorph, as spots are made */
  sees(a: MapSpot, b: MapSpot) {
    // a spot sees itself, e.g. two npcs at one spot see each other
    return a === b || (a.gmId === b.gmId && a.spot.sees.includes(b.spot.id));
  }

  /** The door `a` would see `b` through, once open, as a gdKey */
  seesVia(a: MapSpot, b: MapSpot) {
    const via = a.gmId === b.gmId ? a.spot.seesVia.find(([id]) => id === b.spot.id) : undefined;
    return via === undefined ? null : `g${a.gmId}d${via[1]}`;
  }

  /** Fully crouched at cover spot `a`, they are hidden from `b` */
  crouchHidden(a: MapSpot, b: MapSpot) {
    return a.gmId === b.gmId && a.spot.crouchHidden?.includes(b.spot.id) === true;
  }

  /** Every spot `a` sees */
  seenBy(a: MapSpot) {
    return a.spot.sees.flatMap((id) => this.byKey.get(`g${a.gmId}s${id}`) ?? []);
  }
}

/** A spot of the map, in world coords. `spot` is its geomorph's own record */
export type MapSpot = {
  key: string;
  gmId: number;
  kind: Spot["kind"];
  x: number;
  y: number;
  grKey: null | string;
  /** Radians on the ground plane, as `x/y` */
  facing: undefined | number;
  /** Radians towards its nearest occluder, its least `depth` */
  wall: number;
  spot: Spot;
};

/** Metres per grid cell */
const cellSize = 2;
/** Metres: off any room, e.g. in a doorway, the nearest spot this near is theirs */
const spotOfReach = 2;
/** Metres: the spots of their room this near are all theirs */
const ownReach = 1;
/** Grid rings searched for the nearest spot in a room: 40 metres, past any room's size */
const maxRings = 20;

const cellKey = (x: number, y: number) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
const dist = (u: Geom.VectJson, v: Geom.VectJson) => Math.hypot(u.x - v.x, u.y - v.y);

/** From `p` to the segment `a` `b` */
function distToSeg(p: Geom.VectJson, a: Geom.VectJson, b: Geom.VectJson) {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  map.get(key)?.push(value) ?? map.set(key, [value]);
}
