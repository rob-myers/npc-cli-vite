import { Mat } from "@npc-cli/util/geom/mat";
import type { Spot } from "../spot.schema";
import { type Occluder, SegGrid, segsHit } from "./seg-grid";

/** Tuning for `computeSight`. Lengths in metres */
export const sightConfig = {
  /** A spot stands for the floor this near it: anyone this near is at it */
  regionRadius: 1.25,
  /** Sight is tested to a body this wide either side of a point */
  bodyRadius: 0.25,
  /** Samples on a region's rim, besides its centre */
  rimSamples: 4,
  /** Points along a hull door's opening tested from each spot */
  doorSamples: 5,
  /** Obstacles this high block sight stood */
  standBlockHeight: 1.4,
  /** Obstacles this high hide someone fully crouched */
  crouchHideHeight: 0.6,
  /** Radians either side of a doable's facing seen from it, by its `do`. Any other `do` is stood at */
  doArcs: { sit: (100 * Math.PI) / 180, lie: (30 * Math.PI) / 180 } as Record<string, number>,
};

/** What blocks sight stood, in `layout`'s coords: walls, doors, and obstacles `standBlockHeight` tall. Not windows */
export function createSightGrid(layout: SightLayout) {
  const grid = new SegGrid(1);
  addOccluders(grid, layout);
  return grid;
}

/** What blocks sight stood across `gms`, in world coords: ids are `gmId * sightIdStride` on */
export function createWorldSightGrid(gms: (SightLayout & { matrix: Geom.Mat })[]) {
  const grid = new SegGrid(1);
  gms.forEach((gm, gmId) => addOccluders(grid, gm, gm.matrix, gmId * sightIdStride));
  return grid;
}

/**
 * What blocks sight across `gms`, in world coords, as a list: e.g. to post to a worker.
 * Also lower obstacles, as `low`: they hide only what the line passes under, e.g. someone crouched
 */
export function sightOccluders(gms: (SightLayout & { matrix: Geom.Mat })[]) {
  const occluders: Occluder[] = [];
  const into = {
    add: ([a, b]: [Geom.VectJson, Geom.VectJson], kind: Occluder["kind"], id: number, top?: number) =>
      void occluders.push(top === undefined ? { a, b, kind, id } : { a, b, kind, id, top }),
  };
  gms.forEach((gm, gmId) => addOccluders(into, gm, gm.matrix, gmId * sightIdStride, true));
  return occluders;
}

/** Room for a geomorph's door and obstacle ids, in a world grid */
export const sightIdStride = 10000;

/** Adds `layout`'s occluders to `grid`, by `matrix` if given, their ids offset by `base`. With `low`, lower obstacles too */
function addOccluders(grid: Pick<SegGrid, "add">, layout: SightLayout, matrix?: Geom.Mat, base = 0, low = false) {
  const place = ([a, b]: [Geom.VectJson, Geom.VectJson]): [Geom.VectJson, Geom.VectJson] =>
    matrix === undefined
      ? [a, b]
      : [matrix.transformPoint({ x: a.x, y: a.y }), matrix.transformPoint({ x: b.x, y: b.y })];
  for (const poly of layout.walls) for (const seg of poly.lineSegs) grid.add(place(seg), "wall", -1);
  layout.doors.forEach(({ seg }, doorId) => grid.add(place(seg), "door", base + doorId));
  layout.obstacles.forEach(({ origPoly, transform, height }, obstacleId) => {
    const tall = height >= sightConfig.standBlockHeight;
    if (tall === false && (low === false || height < sightConfig.crouchHideHeight)) return;
    for (const seg of origPoly.clone().applyMatrix(new Mat(transform)).lineSegs) {
      if (tall) grid.add(place(seg), "obstacle", base + obstacleId);
      else grid.add(place(seg), "low", base + obstacleId, height);
    }
  });
}

/** The obstacles of `layout` that `p`, in its coords, stands in: their own sides hide nothing from it */
export function obstaclesAt(layout: Pick<Geomorph.Layout, "obstacles">, p: Geom.VectJson) {
  return layout.obstacles.flatMap(({ origPoly, transform }, id) =>
    origPoly.clone().applyMatrix(new Mat(transform)).contains(p) ? id : [],
  );
}

/** What `p` sees to `radius` in `grid`'s coords, doors shut and open, the obstacles `skip` aside — e.g. to draw */
export function visionAt(grid: SegGrid, p: Geom.VectJson, radius: number, skip = new Set<number>()) {
  return visionsFrom(
    p,
    grid.around(p, radius).filter((o) => isSkipped(o, skip) === false && distToSeg(p, o) <= radius),
  );
}

/** A region's samples on its rim, besides its centre `v.p`: pulled in off walls, so it stays on their side */
export function rimSamples(v: Vision) {
  const c = sightConfig;
  return Array.from({ length: c.rimSamples }, (_, k) => {
    const a = (2 * Math.PI * k) / c.rimSamples - Math.PI;
    const r = Math.max(0, Math.min(c.regionRadius, distAt(v, a) - c.bodyRadius));
    return { x: v.p.x + Math.cos(a) * r, y: v.p.y + Math.sin(a) * r };
  });
}

/** `v` as a polygon, its open stretches as arcs `radius` out */
export function visionPolygon(v: Vision, radius: number) {
  const points: Geom.VectJson[] = [];
  const at = (angle: number, r: number) =>
    points.push({ x: v.p.x + Math.cos(angle) * r, y: v.p.y + Math.sin(angle) * r });
  v.occ.forEach((o, k) => {
    const [a0, a1] = [v.angles[k], v.angles[k + 1]];
    if (o === null) {
      for (let a = a0; a < a1; a += arcStep) at(a, radius);
      at(a1, radius);
    } else {
      at(a0, Math.min(radius, rayDist(v.p, Math.cos(a0), Math.sin(a0), o)));
      at(a1, Math.min(radius, rayDist(v.p, Math.cos(a1), Math.sin(a1), o)));
    }
  });
  return points;
}

/** Radians between points along an arc */
const arcStep = Math.PI / 36;

/**
 * Which spots' regions may see which, and through which doors: sound, so a spot not listed is unseen
 * from anywhere in one region to anywhere in the other — see `docs/perception.md`
 */
export function computeSight({ spots, layout, grid, within, lowNear, radius }: SightInput): SightResult {
  const c = sightConfig;
  const ms = { vision: 0, pairs: 0, do: 0, hull: 0 };
  let t0 = performance.now();

  const regions = spots.map((spot, i): Region => {
    const p = { x: spot.x, y: spot.y };
    const skip = new Set(within[i]);
    const shutOccs = grid
      .around(p, radius + c.regionRadius)
      .filter((o) => isSkipped(o, skip) === false && distToSeg(p, o) <= radius + c.regionRadius);
    const centre = visionsFrom(p, shutOccs);
    const rim = rimSamples(centre.shut);
    const all = [centre, ...rim.map((q) => visionsFrom(q, shutOccs))];
    return { samples: [p, ...rim], skip, shut: all.map((v) => v.shut), open: all.map((v) => v.open) };
  });
  ms.vision = performance.now() - t0;
  t0 = performance.now();

  const sight: number[][] = spots.map(() => []);
  const always: number[][] = spots.map(() => []);
  /** By spot, by door ids joined, the spots seen through those doors */
  const via: Map<string, number[]>[] = spots.map(() => new Map());
  const crouchSafe: number[][] = spots.map(() => []);
  /** Seen from a spot only if within its region's disc, a body wide: one test rejects most pairs */
  const reach = c.regionRadius + c.bodyRadius;
  /** By `"{roomId},{roomId}"`, lesser first: the doors every seeing pair between them needs */
  const roomDoors = new Map<string, number[]>();
  const seesAny = (vs: Vision[], at: Geom.VectJson[]) => vs.some((v) => at.some((q) => seesDisc(v, q, c.bodyRadius)));

  for (let i = 0; i < spots.length; i++) {
    for (let j = i + 1; j < spots.length; j++) {
      const [u, v] = [spots[i], spots[j]];
      if (Math.hypot(v.x - u.x, v.y - u.y) > radius) continue;
      const [A, B] = [regions[i], regions[j]];
      if (
        A.open.every((v) => seesDisc(v, B.samples[0], reach) === false) &&
        B.open.every((v) => seesDisc(v, A.samples[0], reach) === false)
      ) {
        continue;
      }
      if (seesAny(A.open, B.samples) === false && seesAny(B.open, A.samples) === false) continue;
      const skip = new Set([...A.skip, ...B.skip]);
      const doorless = seesAny(A.shut, B.samples) || seesAny(B.shut, A.samples);
      const doors = doorless ? [] : doorsOnEvery(grid, A.samples, B.samples, skip, -1);
      const clear = doorless && hullClear(grid, [...A.samples, ...B.samples], skip);
      for (const [k, l] of [
        [i, j],
        [j, i],
      ]) {
        if (doors.length > 0) via[k].get(`${doors}`)?.push(l) ?? via[k].set(`${doors}`, [l]);
        else (clear ? always : sight)[k].push(l);
        const [watcher, hider] = [regions[l], regions[k]];
        if (spots[k].kind === "cover" && crouchHidden(grid, watcher.samples, hider.samples[0], lowNear[k], skip)) {
          crouchSafe[k].push(l);
        }
      }
      if (u.roomId !== null && v.roomId !== null && u.roomId !== v.roomId) {
        const key = `${Math.min(u.roomId, v.roomId)},${Math.max(u.roomId, v.roomId)}`;
        const prev = roomDoors.get(key);
        roomDoors.set(key, prev === undefined ? doors : prev.filter((d) => doors.includes(d)));
      }
    }
  }
  ms.pairs = performance.now() - t0;
  t0 = performance.now();

  // from a doable's own point, within its arc: who is there cannot step about, nor turn round
  const doArcs: (undefined | number)[] = spots.map(() => undefined);
  const doSight: number[][] = spots.map(() => []);
  const doVia: Map<string, number[]>[] = spots.map(() => new Map());
  spots.forEach((u, i) => {
    const decorId = u.kind === "doable" ? u.ref?.decorId : undefined;
    const doing = decorId === undefined ? undefined : layout.decor[decorId]?.meta.do;
    const arc = typeof doing === "string" ? c.doArcs[doing] : undefined;
    if (arc === undefined || u.facing === undefined) return;
    doArcs[i] = arc;
    const A = regions[i];
    const p = A.samples[0];
    for (let j = 0; j < spots.length; j++) {
      if (j === i || Math.hypot(spots[j].x - u.x, spots[j].y - u.y) > radius) continue;
      const B = regions[j];
      const inArc = B.samples.filter((q) => withinArc(p, q, u.facing as number, arc));
      if (inArc.some((q) => seesDisc(A.open[0], q, c.bodyRadius)) === false) continue;
      const doors = inArc.some((q) => seesDisc(A.shut[0], q, c.bodyRadius))
        ? []
        : doorsOnEvery(grid, [p], inArc, new Set([...A.skip, ...B.skip]), -1);
      if (doors.length === 0) doSight[i].push(j);
      else doVia[i].get(`${doors}`)?.push(j) ?? doVia[i].set(`${doors}`, [j]);
    }
  });
  ms.do = performance.now() - t0;
  t0 = performance.now();

  const hull: [number, number[][]][] = [];
  layout.doors.forEach(({ seg: [a, b], meta }, doorId) => {
    if (meta.hull !== true) return;
    const opening = Array.from({ length: c.doorSamples }, (_, k) => {
      const t = k / (c.doorSamples - 1);
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    });
    const seers = spots.flatMap((spot, i) => {
      if (distToSeg(spot, { a, b }) > radius) return [];
      const R = regions[i];
      if (R.open.some((v) => opening.some((q) => seesDisc(v, q, 0))) === false) return [];
      return [[i, ...doorsOnEvery(grid, R.samples, opening, R.skip, doorId)]];
    });
    hull.push([doorId, seers]);
  });
  ms.hull = performance.now() - t0;

  const rooms = [...roomDoors].map(([key, doors]) => [...key.split(",").map(Number), ...doors]);
  return {
    sight,
    always,
    via: via.map((byDoors) =>
      [...byDoors].map(([key, ids]): [number[], number[]] => [key.split(",").map(Number), ids]),
    ),
    crouchSafe,
    doArcs,
    doSight,
    doVia: doVia.map((byDoors) =>
      [...byDoors].map(([key, ids]): [number[], number[]] => [key.split(",").map(Number), ids]),
    ),
    rooms,
    hull,
    ms,
  };
}

/**
 * What `p` sees past `occs`, doors shut and doors open, from one sweep: the angles from -π to π cut into
 * intervals, each with the occluder nearest across it, `null` for none. Occluders are taken not to cross
 */
export function visionsFrom(p: Geom.VectJson, occs: Occluder[]): { shut: Vision; open: Vision } {
  const evs: [angle: number, o: Occluder, start: boolean][] = [];
  for (const o of occs) {
    const [ax, ay, bx, by] = [o.a.x - p.x, o.a.y - p.y, o.b.x - p.x, o.b.y - p.y];
    const cross = ax * by - ay * bx;
    if (Math.abs(cross) < 1e-9) continue; // edge on: it hides nothing
    let [a1, a2] = [Math.atan2(ay, ax), Math.atan2(by, bx)];
    if (cross < 0) [a1, a2] = [a2, a1];
    if (a1 <= a2) evs.push([a1, o, true], [a2, o, false]);
    else evs.push([a1, o, true], [Math.PI, o, false], [-Math.PI, o, true], [a2, o, false]);
  }
  evs.sort((u, v) => u[0] - v[0]);

  const [shut, open] = [createSweep(), createSweep()];
  const active = new Set<Occluder>();
  let at = -Math.PI;
  for (let i = 0; at < Math.PI; ) {
    for (; i < evs.length && evs[i][0] <= at; i++) {
      if (evs[i][2]) active.add(evs[i][1]);
      else active.delete(evs[i][1]);
    }
    const next = i < evs.length ? Math.min(evs[i][0], Math.PI) : Math.PI;
    const mid = (at + next) / 2;
    const [cos, sin] = [Math.cos(mid), Math.sin(mid)];
    let [nearestShut, nearestOpen] = [null as null | Occluder, null as null | Occluder];
    let [shutDist, openDist] = [Infinity, Infinity];
    for (const o of active) {
      const d = rayDist(p, cos, sin, o);
      if (d < shutDist) [nearestShut, shutDist] = [o, d];
      if (o.kind !== "door" && d < openDist) [nearestOpen, openDist] = [o, d];
    }
    shut.push(nearestShut, next);
    open.push(nearestOpen, next);
    at = next;
  }
  return { shut: shut.done(p), open: open.done(p) };
}

/** Intervals as a sweep reaches them, an interval like the last merged into it */
function createSweep() {
  const angles = [-Math.PI];
  const occ: (null | Occluder)[] = [];
  return {
    push(o: null | Occluder, next: number) {
      if (occ.length > 0 && occ[occ.length - 1] === o) angles[angles.length - 1] = next;
      else occ.push(o), angles.push(next);
    },
    /** With the furthest seen per bin: along an occluder that is at an end of its interval */
    done(p: Geom.VectJson): Vision {
      const far = new Float32Array(farBins);
      occ.forEach((o, k) => {
        const [a0, a1] = [angles[k], angles[k + 1]];
        const m =
          o === null
            ? Infinity
            : Math.max(rayDist(p, Math.cos(a0), Math.sin(a0), o), rayDist(p, Math.cos(a1), Math.sin(a1), o));
        for (let b = binOf(a0); b <= binOf(a1 - 1e-9); b++) if (m > far[b]) far[b] = m;
      });
      return { p, angles, occ, far };
    },
  };
}

/** Metres `v` sees at `angle`, in -π to π */
export function distAt(v: Vision, angle: number) {
  const o = v.occ[indexAt(v.angles, angle)];
  return o === null ? Infinity : rayDist(v.p, Math.cos(angle), Math.sin(angle), o);
}

/** Whether `v` sees some of the disc at `c` of radius `r` */
export function seesDisc(v: Vision, c: Geom.VectJson, r: number) {
  const [dx, dy] = [c.x - v.p.x, c.y - v.p.y];
  const d = Math.hypot(dx, dy);
  if (d <= r) return true;
  const theta = Math.atan2(dy, dx);
  const alpha = Math.asin(r / d);
  if (d - r > farIn(v, theta - alpha, theta + alpha)) return false; // all of it beyond the furthest seen
  if (d <= distAt(v, theta)) return true;
  if (r === 0) return false;
  /** Seen at `phi`, where its ray first meets the disc */
  const seenAt = (phi: number) => {
    const s = d * Math.sin(phi - theta);
    return d * Math.cos(phi - theta) - Math.sqrt(Math.max(0, r * r - s * s)) <= distAt(v, wrap(phi));
  };
  if (seenAt(theta - alpha * 0.999) || seenAt(theta + alpha * 0.999)) return true;
  // either side of each change of occluder across it
  return someAngleIn(v.angles, theta - alpha, theta + alpha, (a) => seenAt(a - 1e-7) || seenAt(a + 1e-7));
}

/** The doors crossed by every clear line between `as` and `bs`, bar `except`. None clear: none needed */
function doorsOnEvery(grid: SegGrid, as: Geom.VectJson[], bs: Geom.VectJson[], skip: Set<number>, except: number) {
  let common: null | number[] = null;
  for (const p of as) {
    for (const q of bs) {
      const doors: number[] = [];
      let blocked = false;
      grid.forEachOn(p, q, (o) => {
        if (isSkipped(o, skip)) return false;
        if (o.kind === "door") return void (o.id !== except && doors.push(o.id));
        return (blocked = true);
      });
      if (blocked) continue;
      common = common === null ? doors : common.filter((d) => doors.includes(d));
      if (common.length === 0) return common;
    }
  }
  return common ?? [];
}

/** `q` is within `arc` either side of `facing` from `p`, a body wide */
function withinArc(p: Geom.VectJson, q: Geom.VectJson, facing: number, arc: number) {
  const d = Math.hypot(q.x - p.x, q.y - p.y);
  if (d === 0) return true;
  const off = Math.atan2(q.y - p.y, q.x - p.x) - facing;
  return Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) <= arc + Math.asin(Math.min(1, sightConfig.bodyRadius / d));
}

/** Nothing occludes the convex hull of `ps`, so every line between them is clear */
function hullClear(grid: SegGrid, ps: Geom.VectJson[], skip: Set<number>) {
  const hull = convexHull(ps);
  const xs = hull.map((p) => p.x);
  const ys = hull.map((p) => p.y);
  const occs = grid.inBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
  return occs.every(
    (o) =>
      isSkipped(o, skip) ||
      (inConvex(hull, o.a) === false &&
        inConvex(hull, o.b) === false &&
        hull.every((h, k) => segsHit(o.a, o.b, h, hull[(k + 1) % hull.length]) === -1)),
  );
}

/** Crouched at `target`, hidden from every watcher point by walls, tall obstacles, or low ones beside it */
function crouchHidden(
  grid: SegGrid,
  watchers: Geom.VectJson[],
  target: Geom.VectJson,
  low: Occluder[],
  skip: Set<number>,
) {
  if (low.length === 0) return false;
  return watchers.every((p) => {
    if (low.some((o) => segsHit(p, target, o.a, o.b) !== -1)) return true;
    let blocked = false;
    grid.forEachOn(p, target, (o) => (isSkipped(o, skip) || o.kind === "door" ? false : (blocked = true)));
    return blocked;
  });
}

/** Metres along the unit ray `(cos, sin)` from `p` to `o`, else `Infinity` */
function rayDist(p: Geom.VectJson, cos: number, sin: number, o: Occluder) {
  const [sx, sy] = [o.b.x - o.a.x, o.b.y - o.a.y];
  const z = cos * sy - sin * sx;
  if (z === 0) return Infinity;
  const t = ((o.a.x - p.x) * sy - (o.a.y - p.y) * sx) / z;
  const u = ((o.a.x - p.x) * sin - (o.a.y - p.y) * cos) / z;
  return t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 ? t : Infinity;
}

/** The furthest `v` sees between `lo` and `hi`, by bin, which may wrap past ±π */
function farIn(v: Vision, lo: number, hi: number) {
  let most = 0;
  for (let k = Math.floor((lo + Math.PI) / binAngle), last = Math.floor((hi + Math.PI) / binAngle); k <= last; k++) {
    const m = v.far[((k % farBins) + farBins) % farBins];
    if (m > most) most = m;
  }
  return most;
}

const farBins = 360;
const binAngle = (2 * Math.PI) / farBins;
const binOf = (angle: number) => Math.min(farBins - 1, Math.max(0, Math.floor((angle + Math.PI) / binAngle)));

/** The interval of `angles` holding `angle`: the last whose start is at or before it */
function indexAt(angles: number[], angle: number) {
  let [lo, hi] = [0, angles.length - 2];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (angles[mid] <= angle) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Whether `fn` holds for some of `angles` between `lo` and `hi`, which may wrap past ±π */
function someAngleIn(angles: number[], lo: number, hi: number, fn: (angle: number) => boolean) {
  for (const shift of [0, 2 * Math.PI, -2 * Math.PI]) {
    const [a, b] = [lo + shift, hi + shift];
    if (b < -Math.PI || a > Math.PI) continue;
    for (let k = indexAt(angles, Math.max(a, -Math.PI)) + 1; k < angles.length - 1 && angles[k] <= b; k++) {
      if (fn(angles[k] - shift)) return true;
    }
  }
  return false;
}

function convexHull(ps: Geom.VectJson[]) {
  const sorted = ps.slice().sort((u, v) => u.x - v.x || u.y - v.y);
  const cross = (o: Geom.VectJson, a: Geom.VectJson, b: Geom.VectJson) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (pts: Geom.VectJson[]) => {
    const h: Geom.VectJson[] = [];
    for (const p of pts) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], p) <= 0) h.pop();
      h.push(p);
    }
    return h.slice(0, -1);
  };
  return [...half(sorted), ...half(sorted.slice().reverse())];
}

function inConvex(vs: Geom.VectJson[], p: Geom.VectJson) {
  if (vs.length < 3) return false;
  for (let i = 0; i < vs.length; i++) {
    const [a, b] = [vs[i], vs[(i + 1) % vs.length]];
    if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < 0) return false;
  }
  return true;
}

function distToSeg(p: Geom.VectJson, { a, b }: { a: Geom.VectJson; b: Geom.VectJson }) {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function isSkipped(o: Occluder, skip: Set<number>) {
  return o.kind === "obstacle" && skip.has(o.id);
}

const wrap = (a: number) => (a < -Math.PI ? a + 2 * Math.PI : a >= Math.PI ? a - 2 * Math.PI : a);

type SightLayout = Pick<Geomorph.Layout, "walls" | "doors" | "obstacles">;

/** What a point sees — see `visionsFrom` */
export type Vision = {
  p: Geom.VectJson;
  angles: number[];
  occ: (null | Occluder)[];
  /** By 1° bin from -π, the furthest seen in it: rejects a disc beyond it at once */
  far: Float32Array;
};

/** A spot's floor as points, and what each sees with doors shut and open */
type Region = { samples: Geom.VectJson[]; skip: Set<number>; shut: Vision[]; open: Vision[] };

type SightInput = {
  spots: Spot[];
  layout: Geomorph.Layout;
  /** Walls, doors and obstacles blocking sight stood */
  grid: SegGrid;
  /** By spot, the obstacles it stands in: their own sides hide nothing from it */
  within: number[][];
  /** By spot, the low obstacles beside it which hide it crouched */
  lowNear: Occluder[][];
  radius: number;
};

type SightResult = {
  /** By spot, the spots its region may see, needing no door */
  sight: number[][];
  /** By spot, the spots its region always sees: every line between is clear */
  always: number[][];
  /** By spot, `[doorIds, spotIds]`: those it may see once all those doors are open */
  via: [number[], number[]][][];
  /** By cover spot, those its region cannot see it from, fully crouched */
  crouchSafe: number[][];
  /** By spot, a doable's arc, if sat or lain at */
  doArcs: (undefined | number)[];
  /** By doable spot with an arc, those seen from its point within that arc, needing no door */
  doSight: number[][];
  /** By doable spot, `[doorIds, spotIds]`: as `doSight`, once all those doors are open */
  doVia: [number[], number[]][][];
  /** `[roomId, roomId, ...doorIds]`, lesser room first */
  rooms: number[][];
  /** `[hullDoorId, [spotId, ...doorIds][]]` */
  hull: [number, number[][]][];
  /** Milliseconds each part took */
  ms: { vision: number; pairs: number; do: number; hull: number };
};
