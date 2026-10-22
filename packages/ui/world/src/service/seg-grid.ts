/** Occluding segments bucketed by cell, so a line meets only those along it */
export class SegGrid {
  cells = new Map<string, Occluder[]>();
  /** Stamped as met, so one in many cells is met once per walk */
  seen = new Map<Occluder, number>();
  stamp = 0;
  /** Metres */
  cell: number;

  constructor(cell: number) {
    this.cell = cell;
  }

  add([a, b]: [Geom.VectJson, Geom.VectJson], kind: Occluder["kind"], id: number, top?: number) {
    const o: Occluder = top === undefined ? { a, b, kind, id } : { a, b, kind, id, top };
    const c = this.cell;
    for (let x = Math.floor(Math.min(a.x, b.x) / c); x <= Math.floor(Math.max(a.x, b.x) / c); x++) {
      for (let y = Math.floor(Math.min(a.y, b.y) / c); y <= Math.floor(Math.max(a.y, b.y) / c); y++) {
        const key = `${x},${y}`;
        this.cells.get(key)?.push(o) ?? this.cells.set(key, [o]);
      }
    }
  }

  /** Each occluder in a cell within `r` of `p`, once */
  around(p: Geom.VectJson, r: number) {
    const stamp = ++this.stamp;
    const c = this.cell;
    const found: Occluder[] = [];
    for (let x = Math.floor((p.x - r) / c); x <= Math.floor((p.x + r) / c); x++) {
      for (let y = Math.floor((p.y - r) / c); y <= Math.floor((p.y + r) / c); y++) {
        for (const o of this.cells.get(`${x},${y}`) ?? []) {
          if (this.seen.get(o) === stamp) continue;
          this.seen.set(o, stamp);
          found.push(o);
        }
      }
    }
    return found;
  }

  /** Each occluder in a cell overlapping the box, once */
  inBox(minX: number, minY: number, maxX: number, maxY: number) {
    const stamp = ++this.stamp;
    const c = this.cell;
    const found: Occluder[] = [];
    for (let x = Math.floor(minX / c); x <= Math.floor(maxX / c); x++) {
      for (let y = Math.floor(minY / c); y <= Math.floor(maxY / c); y++) {
        for (const o of this.cells.get(`${x},${y}`) ?? []) {
          if (this.seen.get(o) === stamp) continue;
          this.seen.set(o, stamp);
          found.push(o);
        }
      }
    }
    return found;
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

/** Where along `p → q` it crosses `a → b`, from `0` to `1`, else `-1` */
export function segsHit(p: Geom.VectJson, q: Geom.VectJson, a: Geom.VectJson, b: Geom.VectJson) {
  const [rx, ry, sx, sy] = [q.x - p.x, q.y - p.y, b.x - a.x, b.y - a.y];
  const z = rx * sy - ry * sx;
  if (z === 0) return -1;
  const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / z;
  const u = ((a.x - p.x) * ry - (a.y - p.y) * rx) / z;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}

/** `low` is an obstacle `top` metres tall, which hides only what the line passes under — see `sightOccluders` */
export type Occluder = {
  a: Geom.VectJson;
  b: Geom.VectJson;
  kind: "wall" | "door" | "obstacle" | "low";
  id: number;
  top?: number;
};
