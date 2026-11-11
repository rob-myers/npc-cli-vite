import { geomService } from "@npc-cli/util/geom-service";
import type { NavMesh } from "navcat";
import { isDoorOpen } from "./handle-perception";
import { pathTo, queryBoundary, slideTo } from "./plan.worker";
import { getSpots } from "./spots";

/**
 * How `npc` makes way for `walker` as `kind`: where to, else why there is no room.
 * Collapsed, they scoot along a wall they are by, else aside, whatever the kind — see `docs/sidestep.md`
 */
export async function planSidestep(
  op: Extract<WW.JshOp, { key: "sidestep" }>,
  navMesh: NavMesh,
  map: WW.JshMapSetup,
): Promise<WW.SidestepPlan> {
  const { npc, walker, kind, tune: t } = op;
  const c = sidestepConfig;
  /** Metres of navmesh edge weighed round them: what this kind looks across, so `back` the width `max` on */
  const reach = kind === "back" ? t.back.max + c.wide : Math.max(c.reach, kind === "wall" ? t.wall.reach : 0);
  const way = unit(walker.heading ?? sub(npc.point, walker.point));
  /** Across the walker's way, toward the npc's side of it */
  const across = cross(way, sub(npc.point, walker.point)) >= 0 ? leftOf(way) : scale(leftOf(way), -1);
  /** The walker's path carried on `pathAhead` along their way, since a wasd step's path stops short of where they go */
  const path = [...walker.path, add(walker.path[walker.path.length - 1] ?? walker.point, scale(way, c.pathAhead))];
  const legs = path.slice(1).map((b, i) => [path[i], b] as const);
  const offPath = (p: Geom.VectJson) => Math.min(...legs.map(([a, b]) => geomService.getDistanceToSeg(p.x, p.y, a, b)));
  const walls = queryBoundary(npc, navMesh, reach).map(({ s }) => ({
    a: { x: s[0], y: s[2] },
    b: { x: s[3], y: s[5] },
  }));
  /** Metres from `p` along `dir` to the navmesh edge, at most `reach` */
  const roomTo = (p: Geom.VectJson, dir: Geom.VectJson) =>
    Math.min(reach, ...walls.map(({ a, b }) => rayHit(p, dir, a, b)));
  /** Toward `to` slid along the navmesh from `from`, if that moves them at least `min` */
  const slide = (from: WW.NpcQuery, to: Geom.VectJson, min = c.minMove) => {
    const p = slideTo(navMesh, from, to);
    return p !== null && dist(p, from.point) >= min ? p : null;
  };
  /** Them as if stood at `p`, their poly looked up afresh */
  const at = (p: Geom.VectJson): WW.NpcQuery => ({ ...npc, point: p, nodeRef: -1 });
  /** Metres from the walker over a step: from where they stand to `lead` on along their way */
  const fromWalker = (p: Geom.VectJson) =>
    geomService.getDistanceToSeg(p.x, p.y, walker.point, add(walker.point, scale(way, c.lead)));
  /** The route a step walks along the navmesh, via `via`, else `null` */
  const routeOf = (to: Geom.VectJson, via: null | Geom.VectJson = null) => {
    const route = [npc.point];
    for (const end of via === null ? [to] : [via, to]) {
      const from = route[route.length - 1];
      const leg = pathTo(navMesh, from === npc.point ? npc : at(from), end);
      if (leg === null) return null;
      route.push(...leg.slice(1));
    }
    return route;
  };
  /** Why a route makes no way: it comes nearer the walker than `pass` or than they stand now, or ends near them */
  const tooNear = (route: Geom.VectJson[]) => {
    const start = fromWalker(npc.point);
    const least = Math.min(c.pass, start) - c.closer;
    for (const [a, b] of route.slice(1).map((p, i) => [route[i], p] as const)) {
      const n = Math.ceil(dist(a, b) / c.sampleBy);
      for (let i = 1; i <= n; i++) {
        const d = fromWalker(add(a, scale(sub(b, a), i / n)));
        if (d < least) return `passes ${walker.key} ${d.toFixed(2)}m off`;
      }
    }
    const end = fromWalker(route[route.length - 1]);
    return end < c.pass && end < start + c.gain ? `ends ${end.toFixed(2)}m from ${walker.key}` : null;
  };
  /** Whether a step to `to` heads on with the walker, within 45° of their way */
  const withWay = (to: Geom.VectJson) => dot(unit(sub(to, npc.point)), way) > c.withWay;
  /** The route a step walks, else why it makes no way */
  const tryStep = (to: Geom.VectJson, via: null | Geom.VectJson = null) => {
    const route = routeOf(to, via);
    return route === null ? "no route" : (tooNear(route) ?? route);
  };
  const [own, far] = [roomTo(npc.point, across), roomTo(npc.point, scale(across, -1))];
  const width = own + far;

  /** Each way of making way: where to, else why there is no room */
  const ways: Record<WW.SidestepYield, () => Found | Promise<Found>> = {
    async aside() {
      const spots = await Promise.resolve()
        .then(getSpots)
        .catch(() => null);
      const grKeys = npc.grKey === null ? [] : [npc.grKey];
      const clear = spots?.clearOf({ point: npc.point, grKeys }, path, op.others) ?? [];
      for (const spot of clear.slice(0, c.spotTries)) {
        const route = withWay(spot) ? "with the way" : tryStep(spot);
        if (typeof route === "string") continue;
        return { ...still, to: { x: spot.x, y: spot.y }, faceWalker: true, reason: `spot ${spot.alias} clear`, route };
      }
      for (const [sign, side] of sides) {
        const to = slide(npc, add(npc.point, scale(across, sign * t.aside.by)));
        const route = to === null ? "no room" : tryStep(to);
        if (to !== null && typeof route !== "string")
          return { ...still, to, faceWalker: true, reason: `across, ${side} side`, route };
      }
      return "no clear spot, nor room either side";
    },
    back() {
      if (width >= t.back.narrow) return `not narrow (${width.toFixed(1)}m)`;
      // on along the walker's way a step at a time, slid along the navmesh, so it follows the passage
      let via = npc.point;
      for (let on = c.backStep; on <= t.back.max + 1e-6; on += c.backStep) {
        const next = slideTo(navMesh, at(via), add(via, scale(way, c.backStep)));
        if (next === null || dist(next, via) < c.backStep / 4)
          return `cannot back past ${(on - c.backStep).toFixed(2)}m`;
        via = next;
        const [l, r] = [roomTo(via, across), roomTo(via, scale(across, -1))];
        if (l + r < c.wide) continue;
        const to = slide(at(via), add(via, scale(across, l >= r ? t.aside.by : -t.aside.by)));
        if (to === null) return `no room aside ${on.toFixed(2)}m on`;
        const reason = `narrow ${width.toFixed(1)}m, wider ${on.toFixed(2)}m on`;
        return { ...still, to, via, faceWalker: true, reason };
      }
      return `no wider within ${t.back.max}m`;
    },
    doorway() {
      const blocked = new Set(npc.blockedGdKeys);
      let found: Found = `no open door within ${t.doorway.reach}m`;
      let nearest = t.doorway.reach;
      for (const gdKey of map.roomDoors[npc.grKey ?? ""] ?? []) {
        const frame = map.doorFrames[gdKey];
        if (frame === undefined || blocked.has(gdKey) || isDoorOpen(gdKey) === false) continue;
        const centre = scale(add(frame.src, frame.dst), 0.5);
        const d = dist(npc.point, centre);
        if (d > nearest || offPath(centre) < c.clear) continue;
        const sign = dot(sub(npc.point, centre), frame.normal) > 0 ? -1 : 1;
        const target = add(centre, scale(frame.normal, sign * t.doorway.through));
        const to = slide(npc, target);
        if (to === null || dist(to, target) > c.reached) continue;
        nearest = d;
        const lines = [seg({ a: frame.src, b: frame.dst })];
        found = { ...still, to, face: centre, reason: `door ${gdKey} open, ${d.toFixed(1)}m`, lines };
      }
      return found;
    },
    shuffle() {
      const whys: string[] = [];
      for (const [sign, side] of sides) {
        const to = slide(npc, add(npc.point, scale(across, sign * t.shuffle.by)), t.shuffle.by / 2);
        const route = to === null ? "no room" : tryStep(to);
        if (to !== null && typeof route !== "string")
          return { ...still, to, shuffle: true, reason: `${side} side`, route };
        whys.push(`${side} side ${route}`);
      }
      return whys.join(", ");
    },
    stand() {
      return { ...still, reason: "holds their ground" };
    },
    turn() {
      const to = slide(npc, add(npc.point, scale(across, t.turn.by)), t.turn.by / 2);
      if (to === null) return "no room for a half-step";
      const reason = `path ${offPath(npc.point).toFixed(2)}m off`;
      return { ...still, to, face: sub(to, across), faceFirst: true, reason };
    },
    wall() {
      /** From the walker to them: a wall back that way is where the walker comes from */
      const away = unit(sub(npc.point, walker.point));
      const offTheirWay = (q: Geom.VectJson) => {
        const to = sub(q, npc.point);
        return dot(to, across) > -c.reached && dot(to, away) > -c.reached;
      };
      const wall = nearestWall(npc.point, walls, t.wall.reach, offTheirWay);
      if (wall === null) return `no wall within ${t.wall.reach}m, off their way`;
      const q = closestOnSeg(npc.point, wall.a, wall.b);
      const d = dist(npc.point, q);
      const out = d > 0.01 ? unit(sub(npc.point, q)) : across;
      const to = d < c.minMove ? null : slide(npc, q);
      if (to !== null && offPath(to) < offPath(npc.point) - c.reached) return "the wall is on their way";
      const reason = to === null ? "against the wall" : `wall ${d.toFixed(2)}m`;
      return { ...still, to, faceWalker: true, face: add(to ?? npc.point, out), reason, lines: [seg(wall)] };
    },
  };

  /** Collapsed, along a wall they are by, else aside */
  const scoot = (): Found | Promise<Found> => {
    const along = nearestWall(npc.point, walls, c.hug);
    if (along === null) return ways.aside();
    const d = unit(sub(along.b, along.a));
    const steps = [1, -1].flatMap((sign) => slide(npc, add(npc.point, scale(d, sign * t.aside.by))) ?? []);
    const to = steps.sort((u, v) => offPath(v) - offPath(u))[0];
    if (to === undefined) return ways.aside();
    return { ...still, to, reason: "collapsed, along the wall", lines: [seg(along)] };
  };

  let found: Found;
  if (npc.dragged === true) found = await scoot();
  else {
    found = await ways[kind]();
    // a step nowhere, e.g. already against the wall, makes no way
    if (typeof found !== "string" && found.to === null && kind !== "stand") found = found.reason;
    // nor does one past the walker, e.g. round what they are pressed against: unless already tried
    if (typeof found !== "string" && found.to !== null && found.route === undefined) {
      const route = tryStep(found.to, found.via);
      found = typeof route === "string" ? route : { ...found, route };
    }
  }
  const cand: Cand = typeof found === "string" ? { ...still, reason: found } : found;

  const draw: WW.SidestepPlan["draw"] = [
    line(walker.path, "path"),
    dashed(walker.path[walker.path.length - 1] ?? walker.point, path[path.length - 1], "path"),
    line([npc.point, add(npc.point, scale(across, own))], "probe"),
    line([npc.point, add(npc.point, scale(across, -far))], "probe"),
    ...(cand.lines ?? []).map((points) => line(points, "wall")),
  ];
  if (cand.to !== null) draw.push(line(cand.route ?? [npc.point, cand.to], "step"));
  if (cand.face !== null) {
    const from = cand.to ?? npc.point;
    draw.push(line([from, add(from, scale(unit(sub(cand.face, from)), c.faceLine))], "face"));
  }

  const { to, via, faceWalker, faceFirst, face, shuffle, reason } = cand;
  return { kind, reason, to, via, faceWalker, faceFirst, face, shuffle, draw };
}

/** A way of making way, as found, and what it draws */
type Cand = Omit<WW.SidestepPlan, "kind" | "draw"> & {
  lines?: Geom.VectJson[][];
  route?: Geom.VectJson[];
};

/** A way's answer: where to, else why there is no room */
type Found = string | Cand;

/** A cand's defaults: going nowhere, facing as they were */
const still = { to: null, via: null, faceWalker: false, faceFirst: false, face: null, shuffle: false };

/** Across the walker's way: their own side, then the far side */
const sides = [
  [1, "own"],
  [-1, "far"],
] as const;

const sidestepConfig = {
  /** Metres the walker's path is carried on along their way, past its end */
  pathAhead: 2,
  /** A spot within 45° of the walker's way is no step aside: the cosine */
  withWay: Math.SQRT1_2,
  /** At most this many of `aside`'s clear spots are tried, nearest first, each a path search */
  spotTries: 4,
  /** The least worth moving once slid along the navmesh. Each kind's own limits are the op's `tune` */
  minMove: 0.2,
  /** Metres of navmesh boundary weighed round them, at least: the room across the walker's way */
  reach: 2,
  /** A step's route keeps `pass` from the walker, else comes no nearer than they stand less `closer` */
  pass: 0.6,
  closer: 0.05,
  /** A step ending within `pass` of the walker must still widen the gap by this, else it is a nudge that makes no way */
  gain: 0.15,
  sampleBy: 0.1,
  /** Metres on along their way the walker is taken to come during a step */
  lead: 0.5,
  /** Within this of where a slide was aimed counts as getting there */
  reached: 0.25,
  /** Navigable metres across the walker's way where `back` stops, stepping on `backStep` at a time */
  wide: 2,
  backStep: 0.25,
  /** One collapsed within `hug` of a wall scoots along it */
  hug: 0.3,
  /** A door's centre must be `clear` of the walker's way to duck through it */
  clear: 0.6,
  /** Metres of the line drawn for which way they face */
  faceLine: 0.4,
};

/** The wall nearest `p` within `within` that `keep` keeps, else `null` */
function nearestWall(p: Geom.VectJson, walls: Wall[], within: number, keep = (_q: Geom.VectJson) => true): null | Wall {
  let [found, nearest] = [null as null | Wall, within];
  for (const wall of walls) {
    const q = closestOnSeg(p, wall.a, wall.b);
    const d = dist(p, q);
    if (d <= nearest && keep(q)) [found, nearest] = [wall, d];
  }
  return found;
}

type Wall = { a: Geom.VectJson; b: Geom.VectJson };

/** How far along the ray `p + t·d` it meets the segment `ab`, else `Infinity` */
function rayHit(p: Geom.VectJson, d: Geom.VectJson, a: Geom.VectJson, b: Geom.VectJson) {
  const e = sub(b, a);
  const den = cross(d, e);
  if (Math.abs(den) < 1e-9) return Infinity;
  const ap = sub(a, p);
  const [t, u] = [cross(ap, e) / den, cross(ap, d) / den];
  return t >= 0 && u >= 0 && u <= 1 ? t : Infinity;
}

function closestOnSeg(p: Geom.VectJson, a: Geom.VectJson, b: Geom.VectJson) {
  const e = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), e) / (dot(e, e) || 1)));
  return add(a, scale(e, t));
}

const seg = ({ a, b }: Wall) => [a, b];
/** A `--debug` line through `points`, coloured by `sidestep` for its `role` */
const line = (points: Geom.VectJson[], role: WW.SidestepRole) => ({
  points: points.map(({ x, y }): [number, number, number] => [x, y, drawHeight]),
  role,
});
/** Metres up their lines are drawn */
const drawHeight = 0.05;
/** A dashed line from `a` to `b` without discs, for what is assumed rather than known, e.g. the walker's path carried on */
const dashed = (a: Geom.VectJson, b: Geom.VectJson, role: WW.SidestepRole) => ({
  ...line([a, b], role),
  dash: 0.15,
  discRadius: 0,
});

const add = (u: Geom.VectJson, v: Geom.VectJson) => ({ x: u.x + v.x, y: u.y + v.y });
const sub = (u: Geom.VectJson, v: Geom.VectJson) => ({ x: u.x - v.x, y: u.y - v.y });
const scale = (u: Geom.VectJson, k: number) => ({ x: u.x * k, y: u.y * k });
const dot = (u: Geom.VectJson, v: Geom.VectJson) => u.x * v.x + u.y * v.y;
const cross = (u: Geom.VectJson, v: Geom.VectJson) => u.x * v.y - u.y * v.x;
const dist = (u: Geom.VectJson, v: Geom.VectJson) => Math.hypot(u.x - v.x, u.y - v.y);
const unit = (u: Geom.VectJson) => scale(u, 1 / (Math.hypot(u.x, u.y) || 1));
/** `u` turned a quarter anticlockwise */
const leftOf = (u: Geom.VectJson) => ({ x: -u.y, y: u.x });
