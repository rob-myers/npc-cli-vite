/** biome-ignore-all lint/correctness/useYield: uniformity */
import { decodeDoorAreaId, isDoorAreaId } from "@npc-cli/ui__world/worker/nav-util";
import { geomService } from "@npc-cli/util/geom-service";
import {
  ANY_QUERY_FILTER,
  createDefaultQueryFilter,
  createFindNearestPolyResult,
  findNearestPoly,
  getNodeByRef,
  isValidNodeRef,
  moveAlongSurface,
  type NavMesh,
  type QueryFilter,
} from "navcat";
import { localBoundary } from "navcat/blocks";

/**
 * One generator per op, each pure given the navmesh and the map's doors. A `yield` is a breath:
 * the world worker's queue runs at each, so a long op `yield`s wherever it can pause
 */
export const ops: {
  [K in JshWW.OpKey]: (
    op: Extract<JshWW.Op, { key: K }>,
    navMesh: NavMesh,
    map: JshWW.MapSetup,
  ) => Generator<void, JshWW.Output[K]>;
} = {
  park: planPark,
  *boundary({ npc }, navMesh) {
    return queryBoundary(npc, navMesh).map(({ s }) => s.slice());
  },
  *pad({ npc, by }, navMesh) {
    const [seg] = queryBoundary(npc, navMesh);
    if (seg === undefined) return null;
    // off the nearest wall, along its inward normal — see `planPark`'s facing
    const [dx, dy] = [seg.s[5] - seg.s[2], seg.s[0] - seg.s[3]];
    const len = Math.hypot(dx, dy) || 1;
    return { x: npc.point.x + (dx / len) * by, y: npc.point.y + (dy / len) * by };
  },
  *nudge({ npc, to }, navMesh) {
    const nodeRef = resolveNodeRef(navMesh, npc);
    if (nodeRef === null) return null;
    // slid along the navmesh, so a step into a wall — or a door they cannot pass — stops at it
    const filter = createParkFilter(new Set(npc.blockedGdKeys), nodeRef);
    const slid = moveAlongSurface(navMesh, nodeRef, [npc.point.x, 0, npc.point.y], [to.x, 0, to.y], filter);
    return slid.success === true ? { x: slid.position[0], y: slid.position[2] } : null;
  },
};

/**
 * Where each npc should stand: against the nearest wall within reach, clear of the room's
 * doorways and its other parked npcs. In order, so each keeps clear of the spots chosen before it
 */
function* planPark(op: Extract<JshWW.Op, { key: "park" }>, navMesh: NavMesh, map: JshWW.MapSetup) {
  // who stands where, by npc: the parked as given, then each plan as it is made
  const standing = new Map(op.parked.map((o) => [o.key, o]));
  const plans: (null | JshWW.ParkPlan)[] = [];

  for (const npc of op.npcs) {
    plans.push(planOne(npc));
    yield; // a breath between npcs
  }
  return plans;

  function planOne(npc: JshWW.NpcQuery): null | JshWW.ParkPlan {
    const segments = queryBoundary(npc, navMesh);
    if (segments.length === 0) return null;

    // only the room's doors and parked npcs: one on the far side of a wall is nothing to them
    const doors = (map.roomDoors[npc.grKey ?? ""] ?? []).flatMap((gdKey) => map.doorFrames[gdKey] ?? []);
    const others = [...standing.values()].filter((o) => o.grKey === npc.grKey && o.key !== npc.key);

    // the nearest segment with a clear point — else the nearest segment, as we always parked:
    // only 8 are kept, and in a tight doorway they can all be frame
    const src = npc.point;
    let at: null | Geom.VectJson = null;
    const seg = segments.find((seg) => (at = findClearPointOnSeg(src, seg, doors, others)) !== null) ?? segments[0];
    at ??= geomService.getClosestOnSeg(src, { x: seg.s[0], y: seg.s[2] }, { x: seg.s[3], y: seg.s[5] });

    // the walkable side: navcat winds its outlines clockwise, so the inside lies along `(dz, -dx)`
    const facing = { x: at.x + (seg.s[5] - seg.s[2]), y: at.y + (seg.s[0] - seg.s[3]) };
    if (npc.grKey !== null) standing.set(npc.key, { key: npc.key, point: at, grKey: npc.grKey, seg: seg.s });
    return { key: npc.key, at, facing, seg: seg.s };
  }
}

/**
 * The navmesh boundary within `parkQueryRange` of them, nearest first — at most 8 segments, and
 * none if they are off the mesh. Asked afresh every time: the crowd's own query is shorter, and
 * an npc stood IN a doorway would otherwise have nothing but its frame
 */
function queryBoundary(npc: JshWW.NpcQuery, navMesh: NavMesh) {
  const nodeRef = resolveNodeRef(navMesh, npc);
  if (nodeRef === null) return [];
  const filter = createParkFilter(new Set(npc.blockedGdKeys), nodeRef);
  localBoundary.updateLocalBoundary(boundary, nodeRef, [npc.point.x, 0, npc.point.y], parkQueryRange, navMesh, filter);
  return boundary.segments;
}

/** Main's ref for them, unless the navmesh has changed under it */
function resolveNodeRef(navMesh: NavMesh, npc: JshWW.NpcQuery) {
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

/**
 * The point on navmesh boundary segment `seg` nearest `src` that no door's traffic runs through,
 * or `null` where the whole of it is in the way. `others` are the room's parked npcs, each with
 * the segment they stand against: a body's width is kept from one along this wall, and more from
 * one across the way, which would make a choke
 */
function findClearPointOnSeg(
  src: Geom.VectJson,
  seg: { s: number[] },
  doors: JshWW.DoorFrame[],
  others: { point: Geom.VectJson; seg: number[] }[],
): null | Geom.VectJson {
  const a = { x: seg.s[0], y: seg.s[2] };
  const len = Math.hypot(seg.s[3] - a.x, seg.s[5] - a.y);
  if (len === 0) return null;
  const d = { x: (seg.s[3] - a.x) / len, y: (seg.s[5] - a.y) / len };
  const along = (p: Geom.VectJson) => (p.x - a.x) * d.x + (p.y - a.y) * d.y;

  // the stretches of wall, as `t` along it, cut out by each doorway and by each parked npc
  const spans: [number, number][] = [
    ...doors.flatMap((door) => {
      const span = doorwayInterval(a, d, door);
      return span === null ? [] : [span];
    }),
    ...others.flatMap((o) => {
      const across = (o.seg[3] - o.seg[0]) * d.x + (o.seg[5] - o.seg[2]) * d.y < 0;
      const radius = across ? parkNpcClearance : parkNpcBesideClearance;
      const t0 = along(o.point);
      const half = Math.sqrt(radius ** 2 - Math.hypot(a.x + d.x * t0 - o.point.x, a.y + d.y * t0 - o.point.y) ** 2);
      return Number.isNaN(half) ? [] : [[t0 - half, t0 + half] as [number, number]]; // NaN: too far off
    }),
  ];

  // the free point nearest where they stand: that point, else the nearest end of a span, nudged
  // a hair clear — only such points can be nearest, and there are few
  const target = Math.max(0, Math.min(len, along(src)));
  const free = (t: number) => t >= 0 && t <= len && spans.every(([lo, hi]) => t <= lo || t >= hi);
  const t = [target, ...spans.flatMap(([lo, hi]) => [lo - parkSlack, hi + parkSlack])]
    .filter(free)
    .sort((u, v) => Math.abs(u - target) - Math.abs(v - target))[0];
  return t === undefined ? null : { x: a.x + d.x * t, y: a.y + d.y * t };
}

/**
 * The stretch of the line `a + d·t` that runs through a doorway: a box in the door's frame, a
 * body's radius past either jamb along it and `doorwayClearance` either side through it. Just past
 * a jamb `along` falls outside, so the wall BESIDE a door is clear to stand against. Both bounds
 * are linear in `t`, so each is a half-line: `c0 + c1·t within (lo, hi)`
 */
function doorwayInterval(a: Geom.VectJson, d: Geom.VectJson, door: JshWW.DoorFrame): null | [number, number] {
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

/** One boundary for every query — the "dummy agent" */
const boundary = localBoundary.create();

// typed copies of the world's constants, which the worker cannot import — see `physics.ts` there
type WorldConst = typeof import("@npc-cli/ui__world/const");
const agentRadius: WorldConst["npcConfig"]["dist"]["agentRadius"] = 0.18;
const doorwayClearance: WorldConst["doorwayClearance"] = 0.6;
const parkQueryRange: WorldConst["parkQueryRange"] = 2;
/** The crowd's `agentPlacementHalfExtents` */
const placementHalfExtents: [number, number, number] = [0.5, 0.5, 0.5];

/** How far a parked npc keeps from parked npcs ACROSS from them, centre to centre */
const parkNpcClearance = 6.5 * agentRadius;
/** …and from those parked along the same wall: a body's width, and a little */
const parkNpcBesideClearance = 4 * agentRadius;
/** A parked point sits this far clear of what cut its span, so a point test agrees */
const parkSlack = 1e-3;
