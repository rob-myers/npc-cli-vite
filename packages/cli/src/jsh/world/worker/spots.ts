import type { SegGrid } from "@npc-cli/ui__world/seg-grid";
import { type Spot, SpotsFileSchema, spotAliasesOf, spotKeyRe } from "@npc-cli/ui__world/spot.schema";
import { sightConfig, sightIdStride } from "@npc-cli/ui__world/spot-sight";
import { fetchParsed, getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";

/**
 * The map's spots, worker-side: each geomorph's under a map-wide key `g{gmId}s{id}` and in world coords,
 * indexed by room and by grid cell. Answers name each by its alias, e.g. `g0r12-3`, and take either.
 * Fetched afresh by each `perception-setup` that changes them — see `docs/spots.md`
 */
export function setupSpots(msg: Extract<WW.PerceptionMsgTo, { type: "perception-setup" }>) {
  const cacheKey = `${msg.mapKey} ${JSON.stringify(msg.gms)} ${msg.spotsRev}`;
  if (current?.cacheKey !== cacheKey) current = { cacheKey, promise: createMapSpots(msg.gms, msg.hullPairs) };
  void current.promise.then((all) => void (all.doableKeys = msg.doableKeys)); // keyed as the World's decor loads
}

/** The spots of the map last set up */
export function getSpots(): Promise<MapSpots> {
  if (current === null) throw Error("no spots set up");
  return current.promise;
}

let current: null | { cacheKey: string; promise: Promise<MapSpots> } = null;

/**
 * Answers each query of a batch in order. Sight is from the lists where they settle it, else lines through `sight`.
 * One that fails answers `{ error }`, not the batch — see `docs/perception.md`
 */
export function answerSpotQueries(
  all: MapSpots,
  { npcs, queries }: WW.SpotsOp,
  { grid, open, doorRev }: { grid: SegGrid; open: Set<string>; doorRev: number },
) {
  const isOpen = (gdKey: string) => open.has(gdKey);
  const npcByKey = new Map(npcs.map((npc) => [npc.key, npc]));
  const resolveNpc = (key: string) => {
    const npc = npcByKey.get(key);
    if (npc === undefined) throw Error(`${key}: not sent`);
    return npc;
  };
  /** A room's or door's spots, by its key e.g. `g0r12` */
  const isGroup = (ref: string) => all.byPrefix.has(ref);
  /** A spot key, else the spot an npc is nearest */
  const resolve = (ref: string) => {
    if (isGroup(ref)) throw Error(`${ref}: a room or door, not a spot`);
    const npc = npcByKey.get(ref);
    const spot = spotKeyRe.test(ref) ? all.get(ref) : npc && all.spotOf(npc.key, npc.point, npc.grKeys[0] ?? null);
    if (spot === undefined) throw Error(`${ref}: no spot`);
    return spot;
  };
  /**
   * Where `ref` is, for the lists: an npc's spots by posture, a room's or door's spots,
   * else the spot, which is sat at if a doable with an arc
   */
  const spotsAt = (ref: string): At => {
    const npc = npcByKey.get(ref);
    if (npc !== undefined) return all.npcSpots(npc);
    const group = all.byPrefix.get(ref);
    if (group !== undefined) return { spots: group, seated: false };
    const spot = resolve(ref);
    return { spots: [spot], seated: spot.spot.doArc !== undefined };
  };
  /** Where `ref` looks from: an npc's own point, else a spot's */
  const eyeOf = (ref: string): Geom.VectJson => npcByKey.get(ref)?.eye ?? resolve(ref);
  /**
   * The lines from `a` to a body at `b`: to its centre and either side. `from` and `to` are npcs there, if any.
   * Their postures set the heights, which a low obstacle may rise above
   */
  const eyeLines = (a: Geom.VectJson, b: Geom.VectJson, from?: WW.SpotNpc, to?: WW.SpotNpc) => {
    const [dx, dy] = [b.x - a.x, b.y - a.y];
    const d = Math.hypot(dx, dy) || 1;
    const [px, py] = [(-dy * headRadius) / d, (dx * headRadius) / d];
    // one sat or lain is on the furniture, which does not hide them
    const lowHides = to === undefined || to.posture === "stand";
    return {
      eye: heightsOf(from).eye,
      top: lowHides ? heightsOf(to).top : null,
      ends: [0, 1, -1].map((k) => ({ x: b.x + k * px, y: b.y + k * py })),
    };
  };
  /** Some of a body at `b` is in sight from `a`, as the doors stand */
  const eyeSees = (a: Geom.VectJson, b: Geom.VectJson, from?: WW.SpotNpc, to?: WW.SpotNpc) => {
    const { eye, top, ends } = eyeLines(a, b, from, to);
    return ends.some((q) => lineHit(a, q, eye, top) === null);
  };
  /**
   * What stops the line, else `null`: a wall, a tall obstacle, a shut door, or a low one it passes under.
   * The first met, or with `nearest` the nearest
   */
  const lineHit = (p: Geom.VectJson, q: Geom.VectJson, eye: number, top: null | number, nearest = false) => {
    let [hit, at] = [null as null | WW.SightHit, Infinity];
    grid.forEachOn(p, q, (o, lambda) => {
      if (o.kind === "door" && open.has(`g${Math.floor(o.id / sightIdStride)}d${o.id % sightIdStride}`)) return false;
      if (o.kind === "low" && (top === null || (o.top ?? 0) < eye + (top - eye) * lambda)) return false;
      if (lambda < at)
        [hit, at] = [{ x: p.x + (q.x - p.x) * lambda, y: p.y + (q.y - p.y) * lambda, kind: o.kind }, lambda];
      return nearest === false;
    });
    return hit;
  };
  /**
   * Whether `a` sees `b` now, and what settled it. Rooms out of view, and pairs the lists never list, are no.
   * Spot to spot the lists say. Those always listed are yes, unless `b` crouches. Only the rest cast lines
   */
  const judge = (refA: string, refB: string): Verdict => {
    const [na, nb] = [npcByKey.get(refA), npcByKey.get(refB)];
    const [A, B] = [spotsAt(refA), spotsAt(refB)];
    const roomsB = nb?.grKeys ?? B.spots.flatMap((s) => s.grKey ?? []);
    const inView = na === undefined || roomsB.length === 0 || roomsB.some((grKey) => na.seeRooms.includes(grKey));
    if (inView === false) return { sees: false, settled: "rooms" };
    const listed = all.listedAny(A, B, isOpen);
    if (listed === "never") return { sees: false, settled: "never" };
    // a room has no one eye to cast lines from
    if ((na === undefined && nb === undefined) || isGroup(refA) || isGroup(refB))
      return { sees: true, settled: listed };
    if (listed === "always" && nb?.crouched !== true) return { sees: true, settled: "always" };
    return { sees: eyeSees(eyeOf(refA), eyeOf(refB), na, nb), settled: "lines" };
  };
  /** `judge`'s verdict, cached with an npc by where they stand and how */
  const seesNow = (refA: string, refB: string) => {
    const [na, nb] = [npcByKey.get(refA), npcByKey.get(refB)];
    if (na === undefined && nb === undefined) return judge(refA, refB);
    const key = `${cacheKeyOf(refA, na)}|${cacheKeyOf(refB, nb)}|${doorRev}`;
    const cached = seesCache.get(key);
    if (cached !== undefined) return cached;
    const verdict = judge(refA, refB);
    remember(key, verdict);
    return verdict;
  };
  /**
   * Every spot `from`, or where they are headed, may see, as the doors stand, else with `alsoOpen` open too.
   * An npc sees only their rooms in view, bar with `alsoOpen`, as those are worked out with the doors as they stand
   */
  const unsafeFrom = (from: string[], ahead: Geom.VectJson[] = [], alsoOpen?: string[]) => {
    const opened = alsoOpen === undefined ? isOpen : (gdKey: string) => isOpen(gdKey) || alsoOpen.includes(gdKey);
    const unsafe = new Set<string>();
    const add = (at: At, inView?: string[]) => {
      for (const s of at.spots) {
        for (const key of all.seenFrom(s, at.seated, opened)) {
          const grKey = all.get(key)?.grKey ?? null;
          if (inView === undefined || grKey === null || inView.includes(grKey)) unsafe.add(key);
        }
      }
    };
    for (const ref of from) add(spotsAt(ref), alsoOpen === undefined ? npcByKey.get(ref)?.seeRooms : undefined);
    for (const p of ahead) {
      const spot = all.nearestTo(p);
      if (spot !== undefined) add({ spots: [spot], seated: false });
    }
    return unsafe;
  };
  /** The spots in `rooms`, else every one */
  const inRooms = (rooms: undefined | string[]) => (rooms === undefined ? [...all.byKey.values()] : all.inRooms(rooms));
  return queries.map((query): WW.SpotAnswer => {
    try {
      switch (query.q) {
        case "of":
          return query.all === true ? spotsAt(query.npc).spots.map(all.json) : all.json(resolve(query.npc));
        case "get":
          return all.json(resolve(query.key));
        case "list": {
          let found = inRooms(query.rooms);
          if (query.kinds !== undefined) found = found.filter((s) => query.kinds?.includes(s.kind));
          if (query.near !== undefined) {
            const npc = npcByKey.get(query.near.npc);
            if (npc === undefined) throw Error(`${query.near.npc}: not sent`);
            const keep = new Set(found);
            found = all.near(npc.point, query.near.within).filter((s) => keep.has(s));
          }
          return found.map(all.json);
        }
        case "sees": {
          const [A, B] = [spotsAt(query.a), spotsAt(query.b)];
          // of a room's spots, those that settled it
          const pair = isGroup(query.a) || isGroup(query.b) ? all.bestListed(A, B, isOpen).pair : null;
          const [a, b] = pair === null ? [A.spots[0], B.spots[0]] : pair.map((key) => all.get(key) as MapSpot);
          return {
            ...seesNow(query.a, query.b),
            via: all.viaOf(a, b),
            crouchHides: a.gmId === b.gmId && b.spot.crouchSafe.includes(a.spot.id),
            from: a.alias,
            to: b.alias,
          };
        }
        case "seenBy":
          return [...unsafeFrom([query.a])].flatMap((key) => all.get(key) ?? []).map(all.json);
        case "at": {
          const spot = all.nearestTo(query.point, query.grKey);
          return spot === undefined ? null : all.json(spot);
        }
        case "hide": {
          const npc = resolveNpc(query.npc);
          const watchers = query.from.filter((ref) => !isGroup(ref)).map(eyeOf); // a room has no eye to be away from
          const unsafe = unsafeFrom(query.from, query.ahead);
          const exclude = new Set(query.exclude?.map((key) => all.get(key)?.key ?? key));
          const prefer = query.prefer ?? [];
          const rank = (s: MapSpot) => (prefer.includes(s.kind) ? prefer.indexOf(s.kind) : prefer.length);
          const { away = 0 } = query;
          const isFar = (s: MapSpot) => watchers.every((w) => dist(s, w) >= away);
          /** By room, what they may see with its doors open */
          const unsafeIn = new Map<string, Set<string>>();
          const unsafeOf = (grKey: string) => {
            let seen = unsafeIn.get(grKey);
            if (seen === undefined)
              unsafeIn.set(grKey, (seen = unsafeFrom(query.from, query.ahead, all.roomDoors.get(grKey))));
            return seen;
          };
          const isUnseen = (s: MapSpot) => {
            if (query.strict !== true || s.grKey === null) return !unsafe.has(s.key);
            const seen = unsafeOf(s.grKey);
            return all.spotsOf({ point: s, grKeys: [s.grKey] }).every((t) => !seen.has(t.key));
          };
          // best first: a far one, else a near one
          const ordered = inRooms(query.rooms)
            .filter((s) => placeKinds.includes(s.kind) && !exclude.has(s.key))
            .sort((u, v) => rank(u) - rank(v) || dist(u, npc.point) - dist(v, npc.point));
          const best = ordered.find((s) => isFar(s) && isUnseen(s)) ?? ordered.find((s) => !isFar(s) && isUnseen(s));
          return best === undefined ? null : all.json(best);
        }
        case "hidden": {
          const doors = resolveNpc(query.npc).grKeys.flatMap((grKey) => all.roomDoors.get(grKey) ?? []);
          const unsafe = unsafeFrom(query.from, query.ahead, doors);
          const seen = spotsAt(query.npc).spots.flatMap((s) => (unsafe.has(s.key) ? [s.alias] : []));
          return { hidden: seen.length === 0, seen };
        }
        case "view": {
          const A = spotsAt(query.from);
          const own = new Set(A.spots);
          const seeRooms = npcByKey.get(query.from)?.seeRooms;
          const view: Record<string, WW.SpotHow> = {};
          for (const s of all.byKey.values()) {
            if (own.has(s)) {
              view[s.alias] = "own";
              continue;
            }
            const B = { spots: [s], seated: false };
            const inView = seeRooms === undefined || s.grKey === null || seeRooms.includes(s.grKey);
            const listed = inView ? all.listedAny(A, B, isOpen) : "never";
            view[s.alias] = listed !== "never" ? listed : all.listedAny(A, B, anyOpen) === "never" ? "never" : "shut";
          }
          return { view };
        }
        case "explain": {
          const [na, nb] = [npcByKey.get(query.a), npcByKey.get(query.b)];
          const [a, b] = [eyeOf(query.a), eyeOf(query.b)];
          const { eye, top, ends } = eyeLines(a, b, na, nb);
          const lines = ends.map((to) => ({ from: a, to, hit: lineHit(a, to, eye, top, true) }));
          const { pair } = all.bestListed(spotsAt(query.a), spotsAt(query.b), isOpen);
          return { ...judge(query.a, query.b), lines, pair, eye, top: heightsOf(nb).top };
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
          return best === undefined ? null : all.json(best);
        }
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });
}

async function createMapSpots(gms: WW.GmForSpots[], hullPairs: [string, string][]) {
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
    const file = byGmKey[gm.key];
    const aliases = file === undefined ? [] : spotAliasesOf(file);
    return (file?.spots ?? []).map((spot) => ({
      key: `g${gmId}s${spot.id}`,
      alias: `g${gmId}${aliases[spot.id]}`,
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
  const hullSpots = new Map(
    gms.flatMap((gm, gmId) =>
      (byGmKey[gm.key]?.hull ?? []).map(
        ([doorId, seers]) =>
          [`g${gmId}d${doorId}`, new Map(seers.map(([id, ...inner]) => [`g${gmId}s${id}`, inner]))] as const,
      ),
    ),
  );
  return new MapSpots(spots, hullSpots, hullPairs);
}

const round = (x: number) => Math.round(x * 100) / 100;
/** Metres either side of the eyes that sight is tested to: inside the head, 0.15 m either side */
const headRadius = 0.12;

/** Metres up to an npc's eye, and to where lines to them end: their eye too, bar fully crouched */
function heightsOf(npc?: WW.SpotNpc) {
  const eye = npc?.eye.h ?? standEyeHeight;
  return { eye, top: npc?.crouched === true ? crouchedTop : eye };
}
/** Metres up to the eyes of one stood, as a spot stands for */
const standEyeHeight = 1.37;
/** Metres up to a fully crouched npc as seen. A rule: their head clears a desk, yet cover `crouchHideHeight` tall hides them */
const crouchedTop = 0.6;
/** Spots an npc is sent to: not a doable, which needs its decor, nor in a doorway */
const placeKinds = ["cover", "corner", "wall", "fill", "decor"];
/** Metres: making way, a spot this near the blocker, this clear of the walker's path and others, not passing within `pass` of the walker */
const makeWay = { within: 2, clear: 0.6, pass: 0.4 };

export class MapSpots {
  byKey = new Map<string, MapSpot>();
  byAlias = new Map<string, MapSpot>();
  /** By a room's or door's key, e.g. `g0r12`, the spots whose alias it begins */
  byPrefix = new Map<string, MapSpot[]>();
  byRoom = new Map<string, MapSpot[]>();
  byCell = new Map<string, MapSpot[]>();
  /** By room, the gdKeys of its doors, from its doorway spots */
  roomDoors = new Map<string, string[]>();
  /** By hull door's gdKey, the spots which may see its opening, each with the inner doors needed */
  hullSpots: Map<string, Map<string, number[]>>;
  /** The same by spot key */
  hullOf = new Map<string, Map<string, number[]>>();
  /** Each hull door's record on the other side */
  hullPair: Map<string, string>;
  /** By `{gmId}/{decorId}`, each doable's decor key, as of the last setup */
  doableKeys: Record<string, string> = {};

  constructor(spots: MapSpot[], hullSpots: Map<string, Map<string, number[]>>, hullPairs: [string, string][]) {
    for (const s of spots) {
      this.byKey.set(s.key, s);
      this.byAlias.set(s.alias, s);
      push(this.byPrefix, s.alias.slice(0, s.alias.lastIndexOf("-")), s);
      if (s.grKey !== null) push(this.byRoom, s.grKey, s);
      if (s.kind === "doorway" && s.grKey !== null) push(this.roomDoors, s.grKey, `g${s.gmId}d${s.spot.ref?.doorId}`);
      push(this.byCell, cellKey(s.x, s.y), s);
    }
    this.hullSpots = hullSpots;
    for (const [gdKey, seers] of hullSpots) {
      for (const [key, inner] of seers) this.hullOf.set(key, (this.hullOf.get(key) ?? new Map()).set(gdKey, inner));
    }
    this.hullPair = new Map(hullPairs);
  }

  /** Each npc's spot last found, kept whilst it is certainly still the nearest */
  lastSpotOf = new Map<string, MapSpot>();
  /** By spot key: half the distance to its room's next nearest spot. Anyone that near it is nearest it */
  halfGapOf = new Map<string, number>();

  /** By key or alias */
  get(key: string) {
    return this.byKey.get(key) ?? this.byAlias.get(key);
  }

  /** As answered: a door or doorway spot names its door, a doable its decor */
  json = (s: MapSpot): WW.SpotJson => {
    const { alias, gmId, kind, x, y, grKey, facing, wall, spot } = s;
    const base = {
      key: alias,
      x: round(x),
      y: round(y),
      grKey,
      ...(facing === undefined ? {} : { facing: round(facing) }),
      wall: round(wall),
      sees: spot.sight.length + spot.always.length,
    };
    if (kind === "door" || kind === "doorway") return { ...base, kind, gdKey: `g${gmId}d${spot.ref?.doorId}` };
    if (kind === "doable") return { ...base, kind, decorKey: this.doableKeys[`${gmId}/${spot.ref?.decorId}`] ?? null };
    return { ...base, kind };
  };

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
  spotsOf({ point, grKeys }: Pick<WW.SpotNpc, "point" | "grKeys">) {
    const close = this.near(point, ownReach);
    // a door spot is in no room
    const door = close.filter((s) => s.kind === "door" && dist(s, point) <= doorReach);
    return door.concat(
      (grKeys.length > 0 ? grKeys : [null]).flatMap((grKey) => {
        const own = close.filter((s) => s.grKey === grKey);
        return own.length > 0 ? own : (this.nearestTo(point, grKey) ?? []);
      }),
    );
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

  /** Where `npc` is, for the lists: the doable they sit or lie at, if it has an arc, else their region spots */
  npcSpots(npc: WW.SpotNpc): At {
    const seat =
      npc.posture === "stand" || npc.doAt === undefined
        ? undefined
        : this.near(npc.doAt, seatReach).find((s) => s.kind === "doable" && s.spot.doArc !== undefined);
    return seat === undefined ? { spots: this.spotsOf(npc), seated: false } : { spots: [seat], seated: true };
  }

  /** How the lists have `a` see `b`, as the doors stand: from `a`'s point within its arc if `seated` */
  listed(a: MapSpot, b: MapSpot, seated: boolean, isOpen: (gdKey: string) => boolean): Listed {
    if (a === b) return "always";
    if (a.gmId !== b.gmId) return this.throughHull(a, isOpen).some((key) => key === b.key) ? "may" : "never";
    const [s, id] = [a.spot, b.spot.id];
    const via = ([doorIds, ids]: [number[], number[]]) =>
      ids.includes(id) && doorIds.every((doorId) => isOpen(`g${a.gmId}d${doorId}`));
    if (seated) return s.doSight.includes(id) || s.doVia.some(via) ? "may" : "never";
    if (s.always.includes(id)) return "always";
    return s.sight.includes(id) || s.via.some(via) ? "may" : "never";
  }

  /** The best of `listed` over every pair of their spots */
  listedAny(A: At, B: At, isOpen: (gdKey: string) => boolean): Listed {
    return this.bestListed(A, B, isOpen).listed;
  }

  /** As `listedAny`, with the pair of spots that gave it, by alias */
  bestListed(A: At, B: At, isOpen: (gdKey: string) => boolean) {
    let best: { listed: Listed; pair: null | [string, string] } = { listed: "never", pair: null };
    for (const a of A.spots) {
      for (const b of B.spots) {
        const listed = this.listed(a, b, A.seated, isOpen);
        if (listed === "always") return { listed, pair: [a.alias, b.alias] as [string, string] };
        if (listed === "may" && best.listed === "never") best = { listed, pair: [a.alias, b.alias] };
      }
    }
    return best;
  }

  /** Every spot `a` may see by its lists, as the doors stand: also across a hull door whose opening it sees */
  seenFrom(a: MapSpot, seated: boolean, isOpen: (gdKey: string) => boolean) {
    const seen = new Set([a.key]);
    const [s, g] = [a.spot, `g${a.gmId}`];
    const add = (ids: number[]) => ids.forEach((id) => seen.add(`${g}s${id}`));
    const addVia = ([doorIds, ids]: [number[], number[]]) =>
      doorIds.every((doorId) => isOpen(`${g}d${doorId}`)) && add(ids);
    if (seated) add(s.doSight), s.doVia.forEach(addVia);
    else add(s.always), add(s.sight), s.via.forEach(addVia);
    for (const key of this.throughHull(a, isOpen)) seen.add(key);
    return seen;
  }

  /** The spots `a` may see across a hull door: those on the other side's list, the doors needed open */
  *throughHull(a: MapSpot, isOpen: (gdKey: string) => boolean) {
    const opened = (g: string, doorIds: number[]) => doorIds.every((d) => isOpen(`${g}d${d}`));
    for (const [gdKey, inner] of this.hullOf.get(a.key) ?? []) {
      const pair = this.hullPair.get(gdKey);
      if (pair === undefined || !isOpen(gdKey) || !isOpen(pair) || !opened(`g${a.gmId}`, inner)) continue;
      const pairG = pair.slice(0, pair.indexOf("d"));
      for (const [key, pairInner] of this.hullSpots.get(pair) ?? []) if (opened(pairG, pairInner)) yield key;
    }
  }

  /** The first door `a` needs open to see `b`, as a gdKey, if any */
  viaOf(a: MapSpot, b: MapSpot) {
    if (a.gmId !== b.gmId) return null;
    const group = [...a.spot.via, ...a.spot.doVia].find(([, ids]) => ids.includes(b.spot.id));
    return group === undefined ? null : `g${a.gmId}d${group[0][0]}`;
  }
}

/** Whether `a` sees `b`, and what settled it */
type Verdict = { sees: boolean; settled: WW.SeesSettled };

/** A spot of the map, in world coords. `spot` is its geomorph's own record */
export type MapSpot = {
  key: string;
  /** Its key as answered and typed, e.g. `g0r12-3` — see `spotAliasesOf` */
  alias: string;
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
const ownReach = sightConfig.regionRadius;
/** Metres from a door spot that stand in its door */
const doorReach = 0.5;
/** Metres from where they sit or lie to its doable spot */
const seatReach = 0.1;

/** Every door open: what may be seen once they are */
const anyOpen = () => true;

/** Where someone is, for the lists: their spots, and whether they sit or lie at the one */
type At = { spots: MapSpot[]; seated: boolean };
type Listed = "never" | "may" | "always";

/** Recent answers of `sees` with an npc, by who, where and how, and the doors' revision */
const seesCache = new Map<string, Verdict>();
const seesCacheMax = 2000;

function remember(key: string, answer: Verdict) {
  if (seesCache.size >= seesCacheMax) seesCache.delete(seesCache.keys().next().value as string);
  seesCache.set(key, answer);
}

/** An npc by where they stand to the centimetre and how, else a spot key: so it only serves those standing still */
function cacheKeyOf(ref: string, npc?: WW.SpotNpc) {
  if (npc === undefined) return ref;
  const { eye, posture, crouched } = npc;
  return `${ref} ${eye.x.toFixed(2)} ${eye.y.toFixed(2)} ${eye.h.toFixed(2)} ${posture} ${crouched}`;
}
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
