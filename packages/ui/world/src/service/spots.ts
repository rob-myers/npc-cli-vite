import { Mat } from "@npc-cli/util/geom/mat";
import { geomService } from "@npc-cli/util/geom-service";
import { ANY_QUERY_FILTER, getPolyWallSegments, type NavMesh } from "navcat";
import { type Spot, type SpotKind, spotKinds } from "../spot.schema";
import { generateTiledNavMeshResult } from "../worker/generate-tiled-navmesh";

/** Tuning for `computeSpots`. Lengths in metres */
export const spotConfig = {
  /** Rays per `depth`, evenly round from `+x` */
  angles: 16,
  /** The furthest `depth` and `sees` reach */
  radius: 10,
  /** Spacing of wall and cover spots along the walkable boundary */
  wallStep: 1,
  /** How far off the boundary a spot along it stands */
  edgeInset: 0.05,
  /** Door spots, either side of its centre line */
  doorStandOff: 0.6,
  /** No wall or cover spot this near a door's centre line */
  doorwayClearance: 0.4,
  /** The least turn of the boundary, outwards, that makes a corner */
  cornerDegrees: 30,
  /** How far into the walkable side a corner spot stands */
  cornerPush: 0.15,
  /** A decor spot is this near its decor at most */
  decorReach: 0.8,
  /** Fill spots are at least this far from any other */
  fillGap: 1.5,
  /** Spots nearer than this are merged into the first made, by `spotKinds` order */
  mergeGap: 0.5,
  nearRadius: 1.5,
  /** Obstacles this high block sight stood */
  standBlockHeight: 1.4,
  /** Obstacles this high hide someone fully crouched */
  crouchHideHeight: 0.6,
  /** Cover spots lose sight past obstacles this near */
  coverReach: 0.5,
};

/** One geomorph's navmesh, in its own coords */
export async function createGmNavMesh(layout: Geomorph.Layout): Promise<NavMesh> {
  const identity: Geom.AffineTransform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const result = await generateTiledNavMeshResult([
    {
      key: layout.key,
      doorways: layout.doors.map((door, doorId) => ({ gmId: 0, doorId, polygon: door.poly.geoJson })),
      triangulation: layout.navDecomp,
      determinant: 1,
      worldBounds: layout.bounds.json,
      gridRect: layout.bounds.json,
      inverseMat3: identity,
      mat3: identity,
      mat4Array: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    },
  ]);
  return result.navMesh;
}

/** Places an npc might stand in `layout`, each with what it sees and what is near — see `docs/spots.md` */
export function computeSpots(layout: Geomorph.Layout, navMesh: NavMesh): Spot[] {
  const c = spotConfig;
  const wallSegs = layout.walls.flatMap((poly) => poly.lineSegs);
  /** `poly.lineSegs`, not `seg`: some windows are curved */
  const windowSegs = layout.windows.flatMap(({ poly }) => poly.lineSegs);
  const doorSegs = layout.doors.map(({ seg }) => seg);
  const obstacles = layout.obstacles.map(({ origPoly, transform, height, meta }, obstacleId) => ({
    obstacleId,
    height,
    meta,
    segs: origPoly.clone().applyMatrix(new Mat(transform)).lineSegs,
  }));
  const navPolys = getNavPolys(navMesh);
  const onMesh = (p: Geom.VectJson) => navPolys.some((poly) => inConvex(poly, p));

  // stood, sight is blocked by walls, shut doors and tall obstacles
  const grid = new SegGrid(1);
  for (const seg of wallSegs) grid.add(seg, "wall", -1);
  doorSegs.forEach((seg, doorId) => grid.add(seg, "door", doorId));
  for (const o of obstacles) {
    if (o.height >= c.standBlockHeight) for (const seg of o.segs) grid.add(seg, "obstacle", o.obstacleId);
  }

  const cands: Cand[] = [];
  const boundary = getBoundary(navMesh);
  const sourceOf = createEdgeSource(layout, [...wallSegs, ...windowSegs], obstacles);

  // along walls, tall obstacles, and obstacles hiding someone crouched
  for (const e of boundary) {
    const source = sourceOf(e);
    if (source === null) continue;
    const kind: SpotKind = source.height >= c.standBlockHeight ? "wall" : "cover";
    const n = Math.max(1, Math.round(e.len / c.wallStep));
    for (let k = 0; k < n; k++) {
      const t = ((k + 0.5) / n) * e.len;
      const p = { x: e.a.x + e.d.x * t + e.n.x * c.edgeInset, y: e.a.y + e.d.y * t + e.n.y * c.edgeInset };
      if (doorSegs.some((seg) => distToSeg(p, seg) < c.doorwayClearance)) continue;
      const ref = source.obstacleId === undefined ? undefined : { obstacleId: source.obstacleId };
      cands.push({ kind, p, facing: Math.atan2(e.n.y, e.n.x), ref });
    }
  }

  // where the boundary turns outwards, as round a wall's end or an obstacle
  for (const { at, n } of getOuterCorners(boundary, c.cornerDegrees)) {
    const p = { x: at.x + n.x * c.cornerPush, y: at.y + n.y * c.cornerPush };
    if (onMesh(p)) cands.push({ kind: "corner", p, facing: Math.atan2(n.y, n.x) });
  }

  // either side of each door, facing it
  layout.doors.forEach(({ center, normal }, doorId) => {
    for (const sign of [1, -1]) {
      const p = { x: center.x + normal.x * sign * c.doorStandOff, y: center.y + normal.y * sign * c.doorStandOff };
      if (onMesh(p))
        cands.push({ kind: "door", p, facing: Math.atan2(-normal.y * sign, -normal.x * sign), ref: { doorId } });
    }
  });

  layout.decor.forEach((d, decorId) => {
    if (d.type === "point" && typeof d.meta.do === "string") {
      cands.push({ kind: "doable", p: { x: d.x, y: d.y }, facing: (d.orient * Math.PI) / 180, ref: { decorId } });
    } else if (d.type === "quad" && d.meta.switch === undefined) {
      const p = nearestWalkable(d.center, boundary, onMesh, c);
      if (p !== null) cands.push({ kind: "decor", p, ref: { decorId } });
    }
  });

  const kept = mergeCands(cands, c.mergeGap);

  // the gaps between, on a grid, nearest first
  const step = c.fillGap / 2;
  const { x: bx, y: by, width, height } = layout.bounds;
  for (let y = by + step / 2; y < by + height; y += step) {
    for (let x = bx + step / 2; x < bx + width; x += step) {
      const p = { x, y };
      if (onMesh(p) && kept.every((o) => Math.hypot(o.p.x - x, o.p.y - y) >= c.fillGap)) {
        kept.push({ kind: "fill", p });
      }
    }
  }

  return describe(kept, layout, obstacles, grid);
}

/** Each spot's room, depth, what it sees, and what is near */
function describe(cands: Cand[], layout: Geomorph.Layout, obstacles: Obstacle[], grid: SegGrid): Spot[] {
  const c = spotConfig;
  /** Obstacles each stands in, e.g. a bed's doable: their own sides do not hide them */
  const within = cands.map(({ p }) => obstacles.filter((o) => inPoly(o.segs, p)).map((o) => o.obstacleId));

  const spots = cands.map(({ kind, p, facing, ref }, id): Spot => {
    const skip = new Set(within[id]);
    const depth = Array.from({ length: c.angles }, (_, k) => {
      const angle = (2 * Math.PI * k) / c.angles;
      const to = { x: p.x + Math.cos(angle) * c.radius, y: p.y + Math.sin(angle) * c.radius };
      let least = 1;
      grid.forEachOn(p, to, (o, lambda) => void (isSkipped(o, skip) === false && (least = Math.min(least, lambda))));
      return round(least * c.radius);
    });
    const roomId = layout.rooms.findIndex((room) => room.contains(p));
    return {
      id,
      kind,
      x: round(p.x),
      y: round(p.y),
      roomId: roomId === -1 ? null : roomId,
      ...(facing === undefined ? {} : { facing: round(facing, 3) }),
      depth,
      sees: [],
      seesVia: [],
      seesDoors: seenDoors(p, layout, grid, skip),
      near: nearTo(p, layout, obstacles),
      ...(ref === undefined ? {} : { ref }),
    };
  });

  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      const [u, v] = [cands[i].p, cands[j].p];
      if (Math.hypot(v.x - u.x, v.y - u.y) > c.radius) continue;
      const skip = new Set([...within[i], ...within[j]]);
      const doors = new Set<number>();
      let blocked = false as boolean;
      grid.forEachOn(u, v, (o) => {
        if (isSkipped(o, skip)) return false;
        if (o.kind === "door") return doors.add(o.id), doors.size > 1;
        return (blocked = true);
      });
      if (blocked === true || doors.size > 1) continue;
      if (doors.size === 0) {
        spots[i].sees.push(j);
        spots[j].sees.push(i);
      } else {
        const [doorId] = doors;
        spots[i].seesVia.push([j, doorId]);
        spots[j].seesVia.push([i, doorId]);
      }
    }
  }

  // cover hides its spot from those whose line to it crosses a low obstacle beside it
  spots.forEach((spot, i) => {
    if (spot.kind !== "cover") return;
    const p = cands[i].p;
    const low = obstacles.filter(
      (o) =>
        o.height >= c.crouchHideHeight &&
        o.height < c.standBlockHeight &&
        Math.min(...o.segs.map((seg) => distToSeg(p, seg))) <= c.coverReach,
    );
    spot.crouchHidden = spot.sees.filter((j) =>
      low.some((o) => o.segs.some(([a, b]) => segsHit(p, cands[j].p, a, b) !== -1)),
    );
  });

  return spots;
}

/** Doors in sight of `p` at a quarter, half or three quarters of the way across */
function seenDoors(p: Geom.VectJson, layout: Geomorph.Layout, grid: SegGrid, skip: Set<number>) {
  const { radius } = spotConfig;
  return layout.doors.flatMap(({ seg: [a, b] }, doorId) => {
    if (distToSeg(p, [a, b]) > radius) return [];
    const seen = [0.25, 0.5, 0.75].some((t) => {
      const to = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      let blocked = false as boolean;
      grid.forEachOn(p, to, (o) => {
        if (isSkipped(o, skip) || (o.kind === "door" && o.id === doorId)) return false;
        return (blocked = true);
      });
      return blocked === false;
    });
    return seen ? doorId : [];
  });
}

function nearTo(p: Geom.VectJson, layout: Geomorph.Layout, obstacles: Obstacle[]): Spot["near"] {
  const r = spotConfig.nearRadius;
  const near: Spot["near"] = { doors: [], decor: [], doables: [], obstacles: [] };
  layout.doors.forEach(({ seg }, doorId) => distToSeg(p, seg) <= r && near.doors.push(doorId));
  layout.decor.forEach((d, decorId) => {
    if (d.meta.label !== undefined) return;
    const at = d.type === "point" ? { x: d.x, y: d.y } : d.center;
    if (Math.hypot(at.x - p.x, at.y - p.y) > r) return;
    (d.type === "point" && typeof d.meta.do === "string" ? near.doables : near.decor).push(decorId);
  });
  for (const o of obstacles) {
    if (o.height > 0 && (inPoly(o.segs, p) || o.segs.some((seg) => distToSeg(p, seg) <= r))) {
      near.obstacles.push(o.obstacleId);
    }
  }
  return near;
}

/** In `spotKinds` order, any too near one kept is dropped. Doables are always kept: a bunk's two share a spot */
function mergeCands(cands: Cand[], gap: number) {
  const sorted = cands.slice().sort((u, v) => spotKinds.indexOf(u.kind) - spotKinds.indexOf(v.kind));
  const kept: Cand[] = [];
  for (const cand of sorted) {
    const { x, y } = cand.p;
    if (cand.kind === "doable" || kept.every(({ p }) => Math.hypot(p.x - x, p.y - y) >= gap)) kept.push(cand);
  }
  return kept;
}

/** `p` if walkable, else the nearest walkable point by the boundary within `decorReach` */
function nearestWalkable(
  p: Geom.VectJson,
  boundary: Edge[],
  onMesh: (p: Geom.VectJson) => boolean,
  c: typeof spotConfig,
) {
  if (onMesh(p)) return { x: p.x, y: p.y };
  let best: null | { d: number; at: Geom.VectJson } = null;
  for (const e of boundary) {
    const t = Math.max(0, Math.min(e.len, (p.x - e.a.x) * e.d.x + (p.y - e.a.y) * e.d.y));
    const at = { x: e.a.x + e.d.x * t + e.n.x * c.edgeInset, y: e.a.y + e.d.y * t + e.n.y * c.edgeInset };
    const d = Math.hypot(at.x - p.x, at.y - p.y);
    if (d <= c.decorReach && (best === null || d < best.d)) best = { d, at };
  }
  return best?.at ?? null;
}

/**
 * Which wall or obstacle a boundary edge was cut by, by whichever is nearest its middle.
 * `null` for a doorway's edge, or an obstacle too low to stand by
 */
function createEdgeSource(layout: Geomorph.Layout, walls: [Geom.Vect, Geom.Vect][], obstacles: Obstacle[]) {
  return (e: Edge): null | { height: number; obstacleId?: number } => {
    const m = { x: e.a.x + (e.d.x * e.len) / 2, y: e.a.y + (e.d.y * e.len) / 2 };
    if (layout.doors.some(({ poly }) => poly.contains(m))) return null;
    const wallD = Math.min(...walls.map((seg) => distToSeg(m, seg)));
    let near: null | { d: number; o: Obstacle } = null;
    for (const o of obstacles) {
      const d = Math.min(...o.segs.map((seg) => distToSeg(m, seg)));
      if (near === null || d < near.d) near = { d, o };
    }
    if (near === null || near.d >= wallD) return { height: Infinity };
    const { height, obstacleId } = near.o;
    return height < spotConfig.crouchHideHeight ? null : { height, obstacleId };
  };
}

/** The navmesh boundary, each edge with its walkable side `n`. navcat winds it clockwise: inside is `(dy, -dx)` */
function getBoundary(navMesh: NavMesh): Edge[] {
  const edges: Edge[] = [];
  for (const tile of Object.values(navMesh.tiles)) {
    for (const nodeIndex of tile.polyNodes) {
      const walls = getPolyWallSegments(navMesh, navMesh.nodes[nodeIndex].ref, ANY_QUERY_FILTER, false);
      if (walls.success === false) continue;
      for (let k = 0; k < walls.segmentVerts.length; k += 6) {
        const s = walls.segmentVerts;
        const a = { x: s[k], y: s[k + 2] };
        const len = Math.hypot(s[k + 3] - a.x, s[k + 5] - a.y);
        if (len < 1e-3) continue;
        const d = { x: (s[k + 3] - a.x) / len, y: (s[k + 5] - a.y) / len };
        edges.push({ a, d, len, n: { x: d.y, y: -d.x } });
      }
    }
  }
  return edges;
}

/** Where the boundary turns outwards by `degrees` or more, with the walkable side's bisector there */
function getOuterCorners(edges: Edge[], degrees: number) {
  const minDot = Math.cos((degrees * Math.PI) / 180);
  const key = ({ x, y }: Geom.VectJson) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
  const byStart = new Map(edges.map((e) => [key(e.a), e]));
  return edges.flatMap((into) => {
    const at = { x: into.a.x + into.d.x * into.len, y: into.a.y + into.d.y * into.len };
    const out = byStart.get(key(at));
    // outwards: turning towards the walkable side, `into × out < 0` as it winds clockwise
    if (out === undefined || into.d.x * out.d.y - into.d.y * out.d.x >= 0) return [];
    if (into.d.x * out.d.x + into.d.y * out.d.y > minDot) return [];
    const [nx, ny] = [into.n.x + out.n.x, into.n.y + out.n.y];
    const norm = Math.hypot(nx, ny);
    return norm === 0 ? [] : [{ at, n: { x: nx / norm, y: ny / norm } }];
  });
}

/** Each navmesh poly's corners on the ground */
function getNavPolys(navMesh: NavMesh) {
  return Object.values(navMesh.tiles).flatMap((tile) =>
    tile.polys.map(({ vertices }) => vertices.map((i) => ({ x: tile.vertices[3 * i], y: tile.vertices[3 * i + 2] }))),
  );
}

function inConvex(vs: Geom.VectJson[], p: Geom.VectJson) {
  let sign = 0;
  for (let i = 0; i < vs.length; i++) {
    const [a, b] = [vs[i], vs[(i + 1) % vs.length]];
    const z = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (z === 0) continue;
    if (sign === 0) sign = Math.sign(z);
    else if (Math.sign(z) !== sign) return false;
  }
  return true;
}

/** Even-odd test over a poly's edges, holes included */
function inPoly(segs: [Geom.Vect, Geom.Vect][], p: Geom.VectJson) {
  let inside = false;
  for (const [a, b] of segs) {
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) inside = !inside;
  }
  return inside;
}

function distToSeg(p: Geom.VectJson, [a, b]: [Geom.VectJson, Geom.VectJson]) {
  return geomService.getDistanceToSeg(p.x, p.y, a, b);
}

/** Where along `p → q` it crosses `a → b`, from `0` to `1`, else `-1` */
function segsHit(p: Geom.VectJson, q: Geom.VectJson, a: Geom.VectJson, b: Geom.VectJson) {
  const [rx, ry, sx, sy] = [q.x - p.x, q.y - p.y, b.x - a.x, b.y - a.y];
  const z = rx * sy - ry * sx;
  if (z === 0) return -1;
  const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / z;
  const u = ((a.x - p.x) * ry - (a.y - p.y) * rx) / z;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}

function isSkipped(o: Occluder, skip: Set<number>) {
  return o.kind === "obstacle" && skip.has(o.id);
}

function round(x: number, decimals = 2) {
  const f = 10 ** decimals;
  return Math.round(x * f) / f;
}

/** Occluding segments bucketed by cell, so a line meets only those along it */
class SegGrid {
  cells = new Map<string, Occluder[]>();
  /** Stamped as met, so one in many cells is met once per line */
  seen = new Map<Occluder, number>();
  stamp = 0;
  /** Metres */
  cell: number;

  constructor(cell: number) {
    this.cell = cell;
  }

  add([a, b]: [Geom.VectJson, Geom.VectJson], kind: Occluder["kind"], id: number) {
    const o: Occluder = { a, b, kind, id };
    const c = this.cell;
    for (let x = Math.floor(Math.min(a.x, b.x) / c); x <= Math.floor(Math.max(a.x, b.x) / c); x++) {
      for (let y = Math.floor(Math.min(a.y, b.y) / c); y <= Math.floor(Math.max(a.y, b.y) / c); y++) {
        const key = `${x},${y}`;
        this.cells.get(key)?.push(o) ?? this.cells.set(key, [o]);
      }
    }
  }

  /** Calls `fn` with each occluder `p → q` crosses and where, stopping once it returns `true` */
  forEachOn(p: Geom.VectJson, q: Geom.VectJson, fn: (o: Occluder, lambda: number) => boolean | undefined) {
    const stamp = ++this.stamp;
    const c = this.cell;
    const [dx, dy] = [q.x - p.x, q.y - p.y];
    let [cx, cy] = [Math.floor(p.x / c), Math.floor(p.y / c)];
    const [ex, ey] = [Math.floor(q.x / c), Math.floor(q.y / c)];
    const [sx, sy] = [Math.sign(dx), Math.sign(dy)];
    const tdx = dx === 0 ? Infinity : Math.abs(c / dx);
    const tdy = dy === 0 ? Infinity : Math.abs(c / dy);
    let tmx = dx === 0 ? Infinity : ((sx > 0 ? cx + 1 : cx) * c - p.x) / dx;
    let tmy = dy === 0 ? Infinity : ((sy > 0 ? cy + 1 : cy) * c - p.y) / dy;
    for (let n = Math.abs(ex - cx) + Math.abs(ey - cy); n >= 0; n--) {
      for (const o of this.cells.get(`${cx},${cy}`) ?? []) {
        if (this.seen.get(o) === stamp) continue;
        this.seen.set(o, stamp);
        const lambda = segsHit(p, q, o.a, o.b);
        if (lambda !== -1 && fn(o, lambda) === true) return;
      }
      if (tmx < tmy) (tmx += tdx), (cx += sx);
      else (tmy += tdy), (cy += sy);
    }
  }
}

type Cand = { kind: SpotKind; p: Geom.VectJson; facing?: number; ref?: Spot["ref"] };

/** A navmesh boundary edge from `a`, along unit `d` for `len`, its walkable side `n` */
type Edge = { a: Geom.VectJson; d: Geom.VectJson; len: number; n: Geom.VectJson };

type Obstacle = { obstacleId: number; height: number; meta: Meta; segs: [Geom.Vect, Geom.Vect][] };

type Occluder = { a: Geom.VectJson; b: Geom.VectJson; kind: "wall" | "door" | "obstacle"; id: number };
