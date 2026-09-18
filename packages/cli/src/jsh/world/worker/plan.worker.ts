import { decodeDoorAreaId, isDoorAreaId } from "@npc-cli/ui__world/worker/nav-util";
import {
  ANY_QUERY_FILTER,
  createDefaultQueryFilter,
  createFindNearestPolyResult,
  findLocalNeighbourhood,
  findNearestPoly,
  getNodeByRef,
  getPolyWallSegments,
  getTileAndPolyByRef,
  isValidNodeRef,
  moveAlongSurface,
  type NavMesh,
  type QueryFilter,
} from "navcat";
import { localBoundary } from "navcat/blocks";

/**
 * One function per op, each pure given the navmesh and the map's doors: plain, async, or a
 * generator — whose every `yield` is a breath, at which the nav worker's queue runs. All are
 * driven the same way, see `handle-message.ts`
 */
export const ops: {
  [K in WW.JshOpKey]: (
    op: Extract<WW.JshOp, { key: K }>,
    navMesh: NavMesh,
    map: WW.JshMapSetup,
  ) => OpResult<WW.JshOutput[K]>;
} = {
  /**
   * Where each npc should stand: against the nearest wall within reach, clear of its corners, of
   * the room's doorways and of its other parked npcs. Room by room, tightest first: each takes the clear
   * point nearest them, and the one with the least wall to spare — after those parked, and after
   * the rest of the room take THEIR first choice — goes next, so nobody is boxed in by a neighbour
   * who had room to spare. Whoever still finds no clear point has the room re-run, going first —
   * and failing that is left where they stand, `null`, rather than parked up against someone
   */
  *park(op, navMesh, map) {
    // who stands where, by npc: the parked as given — bar those re-parking — then each as planned
    const standing = new Map(op.parked.map((o) => [o.key, o]));
    for (const npc of op.npcs) standing.delete(npc.key);
    const plans = new Map<string, null | WW.ParkPlan>();

    // the navmesh is asked once per npc; every choice below is arithmetic on what it gave
    const rooms = new Map<null | string, Cand[]>();
    for (const npc of op.npcs) {
      if (plans.has(npc.key)) continue;
      // only the room's doors and parked npcs: one on the far side of a wall is nothing to them
      const doors = (map.roomDoors[npc.grKey ?? ""] ?? []).flatMap((gdKey) => map.doorFrames[gdKey] ?? []);
      const parked = [...standing.values()].filter((o) => o.grKey === npc.grKey);
      // copied up front: the boundary is one reused object, and each wall reads the others for its corners
      const segs = queryBoundary(npc, navMesh).map(({ s }) => s.slice());
      const walls = segs.flatMap((s) => prepareWall(s, segs, doors, parked) ?? []);
      if (walls.length === 0) {
        plans.set(npc.key, null);
        continue;
      }
      const cand: Cand = { npc, walls, near: [], guess: guessSpot(walls, npc.point), slack: 0 };
      plans.set(npc.key, null); // marks them seen; planned below
      rooms.set(npc.grKey, [...(rooms.get(npc.grKey) ?? []), cand]);
    }

    for (const [grKey, cands] of rooms) {
      // in reach of one another: where one stands may cut a wall of the other
      if (grKey !== null) {
        for (const c of cands) {
          c.near = cands.filter(
            (o) => o !== c && Math.hypot(o.npc.point.x - c.npc.point.x, o.npc.point.y - c.npc.point.y) <= parkReach,
          );
        }
      }
      // whoever found no clear point goes first next time, keeping the pass with the fewest
      const first = new Set<Cand>();
      let best = yield* parkRoom(grKey, cands, first);
      for (let pass = 1; pass < parkPasses && best.failed.some((c) => first.has(c) === false); pass++) {
        for (const c of best.failed) first.add(c);
        const result = yield* parkRoom(grKey, cands, first);
        if (result.failed.length < best.failed.length) best = result;
      }
      for (const [key, plan] of best.plans) plans.set(key, plan); // the failed stay `null`
    }
    return op.npcs.map((npc) => plans.get(npc.key) ?? null);

    function* parkRoom(grKey: null | string, cands: Cand[], first: Set<Cand>): Generator<void, RoomResult> {
      for (const c of cands) {
        standing.delete(c.npc.key);
        for (const w of c.walls) w.cut = w.base.slice();
        c.guess = guessSpot(c.walls, c.npc.point);
      }
      const left = new Set(cands);
      for (const c of cands) c.slack = getSlack(c, left);

      const result: RoomResult = { plans: new Map(), failed: [] };
      while (left.size > 0) {
        // the tightest: least wall to spare, then most in reach — and the re-run's first, first
        const pick = [...left].reduce((p, c) => (tighter(c, p, first) ? c : p));
        left.delete(pick);

        const { npc } = pick;
        const { at, wall, clear } = pick.guess;
        if (clear === false) {
          // not parked at all: right up against someone is worse than where they stand
          result.failed.push(pick);
          yield;
          continue;
        }
        result.plans.set(npc.key, toPlan(npc.key, pick.guess));

        if (grKey !== null) {
          standing.set(npc.key, { key: npc.key, point: at, grKey, seg: wall.s });
          // their spot cuts the walls of those in reach, whose first choice may move — which
          // changes what THEIR neighbours have to spare
          const dirty = new Set<Cand>();
          for (const o of pick.near) {
            if (left.has(o) === false) continue;
            for (const w of o.walls) {
              const span = npcSpan(w, at, wall.s);
              if (span !== null) w.cut.push(span);
            }
            const guess = guessSpot(o.walls, o.npc.point);
            if (guess.at.x !== o.guess.at.x || guess.at.y !== o.guess.at.y) {
              o.guess = guess;
              for (const n of o.near) dirty.add(n);
            }
            dirty.add(o);
          }
          for (const c of dirty) if (left.has(c)) c.slack = getSlack(c, left);
        }
        yield; // a breath between npcs
      }
      return result;
    }
  },
  boundary({ npc }, navMesh) {
    return queryBoundary(npc, navMesh).map(({ s }) => s.slice());
  },
  /**
   * Where each npc may stand with room to walk right round them: `by` from their room's walls and
   * doorways, and from everyone else standing in it. The walls once per npc, up front; then the npcs,
   * room by room, most constrained first — see `padRoom`
   */
  *pad(op, navMesh) {
    const rooms = new Map<null | string, PadCand[]>();
    for (const [index, npc] of op.npcs.entries()) {
      const cand = { npc, index, spots: findPadSpots(npc, navMesh, op.by) };
      rooms.set(npc.grKey, [...(rooms.get(npc.grKey) ?? []), cand]);
      yield; // a breath between npcs
    }

    const plans: (null | WW.PadPlan)[] = op.npcs.map(() => null);
    const padding = new Set(op.npcs.map((npc) => npc.key)); // their old spots no longer count
    for (const [grKey, cands] of rooms) {
      const others = op.others.flatMap((o) => (o.grKey === grKey && padding.has(o.key) === false ? o.point : []));
      // whoever found no spot goes first next time, keeping the pass with the fewest
      const first = new Set<PadCand>();
      let best = yield* padRoom(cands, others, op.by, first);
      for (let pass = 1; pass < padPasses && best.failed.some((c) => first.has(c) === false); pass++) {
        for (const c of best.failed) first.add(c);
        const result = yield* padRoom(cands, others, op.by, first);
        if (result.failed.length < best.failed.length) best = result;
      }
      for (const [c, at] of best.picks) plans[c.index] = { key: c.npc.key, at };
    }
    return plans;
  },
  nudge({ npc, to }, navMesh) {
    const nodeRef = resolveNodeRef(navMesh, npc);
    if (nodeRef === null) return null;
    // slid along the navmesh, so a step into a wall — or a door they cannot pass — stops at it
    const filter = createParkFilter(new Set(npc.blockedGdKeys), nodeRef);
    const slid = moveAlongSurface(navMesh, nodeRef, [npc.point.x, 0, npc.point.y], [to.x, 0, to.y], filter);
    return slid.success === true ? { x: slid.position[0], y: slid.position[2] } : null;
  },
};

type OpResult<T> = T | Promise<T> | Generator<void, T> | AsyncGenerator<void, T>;

/**
 * The navmesh boundary within `parkQueryRange` of them, nearest first — at most 8 segments, and
 * none if they are off the mesh. Asked afresh every time: the crowd's own query is shorter, and
 * an npc stood IN a doorway would otherwise have nothing but its frame
 */
function queryBoundary(npc: WW.NpcQuery, navMesh: NavMesh) {
  const nodeRef = resolveNodeRef(navMesh, npc);
  if (nodeRef === null) return [];
  const filter = createParkFilter(new Set(npc.blockedGdKeys), nodeRef);
  localBoundary.updateLocalBoundary(boundary, nodeRef, [npc.point.x, 0, npc.point.y], parkQueryRange, navMesh, filter);
  return boundary.segments;
}

/** Main's ref for them, unless the navmesh has changed under it */
function resolveNodeRef(navMesh: NavMesh, npc: WW.NpcQuery) {
  if (isValidNodeRef(navMesh, npc.nodeRef) === true) return npc.nodeRef;
  const result = findNearestPoly(
    createFindNearestPolyResult(),
    navMesh,
    [npc.point.x, 0, npc.point.y],
    placementHalfExtents,
    ANY_QUERY_FILTER,
  );
  return result.success === true ? result.nodeRef : null;
}

/** As `Npc.canPassNode`: the door areas they may not pass are refused, bar the one they stand on */
function createParkFilter(blocked: Set<string>, standingRef: number): QueryFilter {
  return {
    ...createDefaultQueryFilter(),
    passFilter(nodeRef, navMesh) {
      const node = getNodeByRef(navMesh, nodeRef);
      return (
        isDoorAreaId(node.area) === false ||
        nodeRef === standingRef ||
        blocked.has(decodeDoorAreaId(node.area).gdKey) === false
      );
    },
  };
}

/** A stretch of wall, as `t` along it, that cannot be stood in */
type Span = [lo: number, hi: number];

/**
 * A navmesh boundary segment `s`, as the line `a + d·t` for `t` in `[0, len]`. `base` is what the
 * room's doorways and its npcs parked before the op cut out of it; `cut` is that plus each npc
 * parked by the op so far, and is reset for a re-run
 */
type Wall = { s: number[]; a: Geom.VectJson; d: Geom.VectJson; len: number; base: Span[]; cut: Span[] };

/** The point they would take now, against `wall` — `clear` false where nothing was, see `guessSpot` */
type Guess = { at: Geom.VectJson; wall: Wall; clear: boolean };

/** An npc waiting to be parked: their walls nearest first, the room's others in reach, and how they stand */
type Cand = { npc: WW.NpcQuery; walls: Wall[]; near: Cand[]; guess: Guess; slack: number };

type RoomResult = { plans: Map<string, WW.ParkPlan>; failed: Cand[] };

function prepareWall(
  s: number[],
  segs: number[][],
  doors: WW.DoorFrame[],
  parked: { point: Geom.VectJson; seg: number[] }[],
) {
  const a = { x: s[0], y: s[2] };
  const len = Math.hypot(s[3] - a.x, s[5] - a.y);
  if (len === 0) return null;
  const wall: Wall = { s, a, d: { x: (s[3] - a.x) / len, y: (s[5] - a.y) / len }, len, base: [], cut: [] };
  // a corner is stood clear of, either side: wedged into one is as bad as stuck out past one
  if (isCorner(s, segs, 0)) wall.base.push([-parkSlack, parkCornerClearance]);
  if (isCorner(s, segs, 3)) wall.base.push([len - parkCornerClearance, len + parkSlack]);
  for (const door of doors) {
    const span = doorwayInterval(a, wall.d, door);
    if (span !== null) wall.base.push(span);
  }
  for (const o of parked) {
    const span = npcSpan(wall, o.point, o.seg);
    if (span !== null) wall.base.push(span);
  }
  wall.cut = wall.base.slice();
  return wall;
}

/**
 * Does another segment meet `s` at its end `at` (0 or 3), bending `parkCornerDegrees` or more?
 * Compared by the way each runs AWAY from the point, so straight on is `u . v === -1` — which is
 * how a wall split across polys, meeting end to end, is left whole
 */
function isCorner(s: number[], segs: number[][], at: 0 | 3) {
  const [px, py] = [s[at], s[at + 2]];
  const [ux, uy] = [s[3 - at] - px, s[5 - at] - py];
  return segs.some((o) => {
    const meets = (i: 0 | 3) => Math.abs(o[i] - px) < parkCornerEps && Math.abs(o[i + 2] - py) < parkCornerEps;
    const end = o === s ? -1 : meets(0) ? 0 : meets(3) ? 3 : -1;
    if (end === -1) return false;
    const [vx, vy] = [o[3 - end] - px, o[5 - end] - py];
    const norm = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    return norm > 0 && (ux * vx + uy * vy) / norm >= parkCornerDot;
  });
}

function along({ a, d }: Wall, p: Geom.VectJson) {
  return (p.x - a.x) * d.x + (p.y - a.y) * d.y;
}

/**
 * The stretch of `wall` an npc parked at `point` against `seg` takes: a body's width where they
 * stand along this wall, and more where they stand across the way, which would make a choke
 */
function npcSpan(wall: Wall, point: Geom.VectJson, seg: number[]): null | Span {
  const { a, d } = wall;
  const across = (seg[3] - seg[0]) * d.x + (seg[5] - seg[2]) * d.y < 0;
  const radius = across ? parkNpcClearance : parkNpcBesideClearance;
  const t0 = along(wall, point);
  const half = Math.sqrt(radius ** 2 - Math.hypot(a.x + d.x * t0 - point.x, a.y + d.y * t0 - point.y) ** 2);
  return Number.isNaN(half) ? null : [t0 - half, t0 + half]; // NaN: too far off
}

/**
 * The free point on `wall` nearest `src`, as `t`, or `null` where the whole of it is cut: that
 * point, else the nearest end of a span, nudged a hair clear — only such points can be nearest,
 * and there are few
 */
function findClearT(wall: Wall, src: Geom.VectJson, spans: Span[]): null | number {
  const { len } = wall;
  const target = Math.max(0, Math.min(len, along(wall, src)));
  const free = (t: number) => t >= 0 && t <= len && spans.every(([lo, hi]) => t <= lo || t >= hi);
  const t = [target, ...spans.flatMap(([lo, hi]) => [lo - parkSlack, hi + parkSlack])]
    .filter(free)
    .sort((u, v) => Math.abs(u - target) - Math.abs(v - target))[0];
  return t === undefined ? null : t;
}

/** How much of `wall` is left, once the `spans` are cut out */
function freeLength({ len }: Wall, spans: Span[]) {
  let free = len;
  let end = 0; // covered up to here, so overlaps count once
  for (const [lo, hi] of spans.slice().sort((u, v) => u[0] - v[0])) {
    const [from, to] = [Math.max(end, lo, 0), Math.min(hi, len)];
    if (to > from) free -= to - from;
    end = Math.max(end, to);
  }
  return free;
}

/**
 * Where they would park now, given only the walls' `cut`: the nearest wall with a clear point —
 * else the nearest wall, not `clear`: a stand-in for the ordering, never parked at
 */
function guessSpot(walls: Wall[], src: Geom.VectJson): Guess {
  for (const wall of walls) {
    const t = findClearT(wall, src, wall.cut);
    if (t !== null) return { at: pointAt(wall, t), wall, clear: true };
  }
  const [wall] = walls;
  return { at: pointAt(wall, Math.max(0, Math.min(wall.len, along(wall, src)))), wall, clear: false };
}

function pointAt({ a, d }: Wall, t: number) {
  return { x: a.x + d.x * t, y: a.y + d.y * t };
}

/** Parked at a clear guess, facing the walkable side: navcat winds its outlines clockwise, so the inside lies along `(dz, -dx)` */
function toPlan(key: string, { at, wall }: Guess): WW.ParkPlan {
  const facing = { x: at.x + (wall.s[5] - wall.s[2]), y: at.y + (wall.s[0] - wall.s[3]) };
  return { key, at, facing, seg: wall.s };
}

/**
 * The wall they have to spare: what is left of theirs after the parked, and after each of those
 * `left` in reach takes their own first choice. An estimate — those choices may overlap — but it
 * only decides the order
 */
function getSlack(c: Cand, left: Set<Cand>) {
  let slack = 0;
  for (const wall of c.walls) {
    const spans = wall.cut.slice();
    for (const o of c.near) {
      if (left.has(o) === false) continue;
      const span = npcSpan(wall, o.guess.at, o.guess.wall.s);
      if (span !== null) spans.push(span);
    }
    slack += freeLength(wall, spans);
  }
  return slack;
}

/** Should `c` park before `p`: those a re-run puts `first`, then the least slack, then most in reach */
function tighter(c: Cand, p: Cand, first: Set<Cand>) {
  if (first.has(c) !== first.has(p)) return first.has(c);
  if (c.slack !== p.slack) return c.slack < p.slack;
  return c.near.length > p.near.length;
}

/**
 * The stretch of the line `a + d·t` that runs through a doorway: a box in the door's frame, a
 * body's radius past either jamb along it and `doorwayClearance` either side through it. Just past
 * a jamb `along` falls outside, so the wall BESIDE a door is clear to stand against. Both bounds
 * are linear in `t`, so each is a half-line: `c0 + c1·t within (lo, hi)`
 */
function doorwayInterval(a: Geom.VectJson, d: Geom.VectJson, door: WW.DoorFrame): null | [number, number] {
  const [dx, dy] = [door.dst.x - door.src.x, door.dst.y - door.src.y];
  const len = Math.hypot(dx, dy);
  const r = agentRadius;
  const bounds: [c0: number, c1: number, lo: number, hi: number][] = [
    [((a.x - door.src.x) * dx + (a.y - door.src.y) * dy) / len, (d.x * dx + d.y * dy) / len, -r, len + r],
    [
      (a.x - door.src.x) * door.normal.x + (a.y - door.src.y) * door.normal.y,
      d.x * door.normal.x + d.y * door.normal.y,
      -doorwayClearance,
      doorwayClearance,
    ],
  ];
  let tLo = Number.NEGATIVE_INFINITY;
  let tHi = Number.POSITIVE_INFINITY;
  for (const [c0, c1, lo, hi] of bounds) {
    if (Math.abs(c1) < 1e-9) {
      if (c0 <= lo || c0 >= hi) return null; // parallel, and outside
      continue;
    }
    const [u, v] = [(lo - c0) / c1, (hi - c0) / c1];
    tLo = Math.max(tLo, Math.min(u, v));
    tHi = Math.min(tHi, Math.max(u, v));
  }
  return tLo < tHi ? [tLo, tHi] : null;
}

/** An npc to pad: their place in `op.npcs`, and the spots with room from the walls, nearest first */
type PadCand = { npc: WW.NpcQuery; index: number; spots: Geom.VectJson[] };

/**
 * The spots near them at least `by` from every wall — ONE navmesh query, the rest arithmetic.
 * Doors are refused, bar one stood in: so the flood keeps to their room, and each doorway counts
 * as wall, which keeps a spot out of it too
 */
function findPadSpots(npc: WW.NpcQuery, navMesh: NavMesh, by: number): Geom.VectJson[] {
  const nodeRef = resolveNodeRef(navMesh, npc);
  if (nodeRef === null) return [];
  const filter: QueryFilter = {
    ...createDefaultQueryFilter(),
    passFilter: (ref, navMesh) => ref === nodeRef || isDoorAreaId(getNodeByRef(navMesh, ref).area) === false,
  };
  const { x, y } = npc.point;
  const hood = findLocalNeighbourhood(navMesh, nodeRef, [x, 0, y], padQueryRange + by, filter);
  if (hood.success === false) return [];

  const polys: number[][] = []; // outlines `[x, z, ...]`
  const walls: number[] = []; // segments `[x1, y1, z1, x2, y2, z2, ...]`
  for (const ref of hood.nodeRefs) {
    const found = getTileAndPolyByRef(ref, navMesh);
    if (found.success === false) continue;
    const vs = found.tile.vertices;
    polys.push(found.poly.vertices.flatMap((i) => [vs[i * 3], vs[i * 3 + 2]]));
    const segs = getPolyWallSegments(navMesh, ref, filter, false);
    if (segs.success === true) walls.push(...segs.segmentVerts);
  }

  const spots: Geom.VectJson[] = [];
  for (let ring = 0; ring * padStep <= padQueryRange; ring++) {
    for (let i = 0; i < (ring === 0 ? 1 : padDirs); i++) {
      const angle = (i / padDirs) * Math.PI * 2;
      const p = { x: x + Math.cos(angle) * ring * padStep, y: y + Math.sin(angle) * ring * padStep };
      if (polys.some((poly) => inConvexPoly(p, poly)) && isClearOfWalls(p, walls, by)) spots.push(p);
    }
  }
  return spots;
}

/** On or inside a convex outline `[x, z, ...]`, whichever way it winds */
function inConvexPoly(p: Geom.VectJson, poly: number[]) {
  let sign = 0;
  for (let i = 0, j = poly.length - 2; i < poly.length; j = i, i += 2) {
    const cross = (poly[i] - poly[j]) * (p.y - poly[j + 1]) - (poly[i + 1] - poly[j + 1]) * (p.x - poly[j]);
    if (cross !== 0 && sign !== 0 && cross > 0 !== sign > 0) return false;
    if (cross !== 0) sign = cross;
  }
  return true;
}

function isClearOfWalls(p: Geom.VectJson, walls: number[], by: number) {
  for (let i = 0; i < walls.length; i += 6) {
    const [ax, ay, dx, dy] = [walls[i], walls[i + 2], walls[i + 3] - walls[i], walls[i + 5] - walls[i + 2]];
    const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / (dx * dx + dy * dy || 1)));
    if ((p.x - ax - dx * t) ** 2 + (p.y - ay - dy * t) ** 2 < by ** 2) return false;
  }
  return true;
}

/**
 * One room: a spot is free when `by` from everyone `taken` — those already standing there, and each
 * pick as it is made. Fewest free spots goes next — the re-run's `first`, first — and takes their
 * nearest. Arithmetic only, so a re-run costs no navmesh query — but every pick recounts the
 * room, so there is a breath after each
 */
function* padRoom(cands: PadCand[], others: Geom.VectJson[], by: number, first: Set<PadCand>) {
  const taken = others.slice();
  const left = new Set(cands);
  const picks = new Map<PadCand, Geom.VectJson>();
  const failed: PadCand[] = [];
  const free = (c: PadCand) => c.spots.filter((s) => taken.every((t) => Math.hypot(t.x - s.x, t.y - s.y) >= by));

  while (left.size > 0) {
    let [pick, spots, rank] = [undefined as undefined | PadCand, [] as Geom.VectJson[], Number.POSITIVE_INFINITY];
    for (const c of left) {
      const mine = free(c);
      const r = (first.has(c) ? 0 : 1e6) + mine.length;
      if (r < rank) [pick, spots, rank] = [c, mine, r];
    }
    if (pick === undefined) break;
    left.delete(pick);
    if (spots.length === 0) failed.push(pick);
    else {
      picks.set(pick, spots[0]);
      taken.push(spots[0]);
    }
    yield;
  }
  return { picks, failed };
}

/** One boundary for every query — the "dummy agent" */
const boundary = localBoundary.create();

// typed copies of the world's constants, which the worker cannot import — see `physics.ts` there
type WorldBoath = typeof import("@npc-cli/ui__world/const.both");
type WorldNpc = typeof import("@npc-cli/ui__world/const.npc");
const agentRadius: WorldBoath["npcDims"]["agentRadius"] = 0.18;
const doorwayClearance: WorldNpc["doorwayClearance"] = 0.6;
const parkQueryRange: WorldNpc["parkQueryRange"] = 2;
const padQueryRange: WorldNpc["padQueryRange"] = 3;
/** The crowd's `agentPlacementHalfExtents` */
const placementHalfExtents: [number, number, number] = [0.5, 0.5, 0.5];

/** How far a parked npc keeps from parked npcs ACROSS from them, centre to centre */
const parkNpcClearance = 6.5 * agentRadius;
/** …and from those parked along the same wall: a body's width, and a little */
const parkNpcBesideClearance = 4 * agentRadius;
/** A boundary bend of this or more is a corner, kept clear of — see `cornerSpans` */
const parkCornerDegrees = 30;
/** That bend as a dot product of the two ways out of the corner: straight on is `-1` */
const parkCornerDot = -Math.cos((parkCornerDegrees * Math.PI) / 180);
/** How far a parked npc keeps from a corner, along the wall */
const parkCornerClearance = 2 * agentRadius;
/** Two boundary segments this close share their endpoint */
const parkCornerEps = 1e-4;
/** Npcs further apart than this cannot contend: each parks within range, and cuts no further */
const parkReach = 2 * parkQueryRange + parkNpcClearance;
/** A room is re-run at most this many times for those who found no clear point */
const parkPasses = 3; /** A parked point sits this far clear of what cut its span, so a point test agrees */
const parkSlack = 1e-3;

/** `pad`'s candidate spots: a ring every this far, this many to a ring */
const padStep = 0.3;
const padDirs = 12;
/** A room is re-run at most this many times for those who found no spot */
const padPasses = 3;
