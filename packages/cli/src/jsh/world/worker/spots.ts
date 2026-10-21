import { type Spot, SpotsFileSchema } from "@npc-cli/ui__world/spot.schema";
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
export function answerSpotQueries(all: MapSpots, { npcs, queries }: Extract<WW.JshOp, { key: "spots" }>) {
  const npcByKey = new Map(npcs.map((npc) => [npc.key, npc]));
  const resolveNpc = (key: string) => {
    const npc = npcByKey.get(key);
    if (npc === undefined) throw Error(`${key}: not sent`);
    return npc;
  };
  /** A spot key, else the spot an npc is at */
  const resolve = (ref: string) => {
    const npc = npcByKey.get(ref);
    const spot = spotKeyRe.test(ref) ? all.get(ref) : npc && all.spotOf(npc.key, npc.point, npc.grKey);
    if (spot === undefined) throw Error(`${ref}: no spot`);
    return spot;
  };
  /** The spots in `rooms`, else every one */
  const inRooms = (rooms: undefined | string[]) => (rooms === undefined ? [...all.byKey.values()] : all.inRooms(rooms));
  return queries.map((query): WW.SpotAnswer => {
    try {
      switch (query.q) {
        case "of":
          return toJson(resolve(query.npc));
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
          return {
            sees: all.sees(a, b),
            via: all.seesVia(a, b),
            crouchHides: all.crouchHidden(b, a),
            from: a.key,
            to: b.key,
          };
        }
        case "seenBy":
          return all.seenBy(resolve(query.a)).map(toJson);
        case "at": {
          const spot = all.nearestTo(query.point, query.grKey);
          return spot === undefined ? null : toJson(spot);
        }
        case "hide": {
          const npc = resolveNpc(query.npc);
          const watchers = query.from.map(resolve);
          const exclude = new Set(query.exclude);
          const prefer = query.prefer ?? [];
          const rank = (s: MapSpot) => (prefer.includes(s.kind) ? prefer.indexOf(s.kind) : prefer.length);
          const unseen = inRooms(query.rooms).filter(
            (s) => placeKinds.includes(s.kind) && !exclude.has(s.key) && !watchers.some((w) => all.sees(w, s)),
          );
          const { away = 0 } = query;
          const far = unseen.filter((s) => watchers.every((w) => dist(s, w) >= away));
          const best = (far.length > 0 ? far : unseen).sort(
            (u, v) => rank(u) - rank(v) || dist(u, npc.point) - dist(v, npc.point),
          )[0];
          return best === undefined ? null : toJson(best);
        }
        case "search": {
          const npc = resolveNpc(query.npc);
          const area = inRooms(query.rooms);
          const unseen = new Set(area.filter((s) => !query.seen.includes(s.key)).map((s) => s.key));
          /** Spots it would see not yet seen, less a cost for the walk there */
          const score = (s: MapSpot) =>
            all.seenBy(s).filter((t) => unseen.has(t.key)).length +
            (unseen.has(s.key) ? 1 : 0) -
            searchWalkCost * dist(s, npc.point);
          const exclude = new Set(query.exclude);
          const best = area
            .filter((s) => placeKinds.includes(s.kind) && !exclude.has(s.key))
            .map((s) => ({ s, score: score(s) }))
            .sort((u, v) => v.score - u.score)[0];
          return best === undefined || best.score <= 0 ? null : toJson(best.s);
        }
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
}

async function createMapSpots(gms: WW.GmForSpots[]) {
  const gmKeys = [...new Set(gms.map((gm) => gm.key))];
  const files = await Promise.all(
    gmKeys.map((gmKey) => fetchParsed(`/spot/${gmKey}.json${getDevCacheBustQueryParam()}`, SpotsFileSchema)),
  );
  const byGmKey = Object.fromEntries(files.map((file) => [file.gmKey, file]));
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
/** Spots an npc is sent to: not a doable, which needs its decor, nor in a doorway */
const placeKinds = ["cover", "corner", "wall", "fill", "decor"];
/** Seen spots a metre more walk is worth, choosing where to search */
const searchWalkCost = 0.5;
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
/** Grid rings searched for the nearest spot in a room: 40 metres, past any room's size */
const maxRings = 20;

const cellKey = (x: number, y: number) => `${Math.floor(x / cellSize)},${Math.floor(y / cellSize)}`;
const dist = (u: Geom.VectJson, v: Geom.VectJson) => Math.hypot(u.x - v.x, u.y - v.y);

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  map.get(key)?.push(value) ?? map.set(key, [value]);
}
