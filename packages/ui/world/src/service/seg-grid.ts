/** Occluding segments bucketed by cell, so a line meets only those along it */
export class SegGrid {
  /** By `cellKey` */
  cells = new Map<number, Occluder[]>();
  /** Each walk's, marked on what it meets, so one in many cells is met once per walk */
  stamp = 0;
  /** By id, the cells each decor occluder is in: only decor is removed */
  decorCells = new Map<number, number[]>();
  /** Metres */
  cell: number;

  constructor(cell: number) {
    this.cell = cell;
  }

  /** A grid of `occluders`, e.g. a list `occluders()` gave, posted to a thread */
  static of(cell: number, occluders: Occluder[]) {
    const grid = new SegGrid(cell);
    for (const o of occluders) grid.add([o.a, o.b], o.kind, o.id, o.top);
    return grid;
  }

  /** Each occluder once, as plain data */
  occluders() {
    return [...new Set([...this.cells.values()].flat())];
  }

  add([a, b]: [Geom.VectJson, Geom.VectJson], kind: Occluder["kind"], id: number, top?: number) {
    // one shape for all, however made, and none met yet
    const o: Occluder = { a, b, kind, id, top, stamp: 0 };
    const c = this.cell;
    for (let x = Math.floor(Math.min(a.x, b.x) / c); x <= Math.floor(Math.max(a.x, b.x) / c); x++) {
      for (let y = Math.floor(Math.min(a.y, b.y) / c); y <= Math.floor(Math.max(a.y, b.y) / c); y++) {
        const key = cellKey(x, y);
        this.cells.get(key)?.push(o) ?? this.cells.set(key, [o]);
        if (kind === "decor") this.decorCells.get(id)?.push(key) ?? this.decorCells.set(id, [key]);
      }
    }
  }

  /** Removes decor `id`'s occluders */
  removeDecor(id: number) {
    for (const key of this.decorCells.get(id) ?? []) {
      const kept = (this.cells.get(key) ?? []).filter((o) => o.kind !== "decor" || o.id !== id);
      if (kept.length === 0) this.cells.delete(key);
      else this.cells.set(key, kept);
    }
    this.decorCells.delete(id);
  }

  /** Each occluder in a cell within `r` of `p`, once */
  around(p: Geom.VectJson, r: number) {
    return this.inBox(p.x - r, p.y - r, p.x + r, p.y + r);
  }

  /** Each occluder in a cell overlapping the box, once */
  inBox(minX: number, minY: number, maxX: number, maxY: number) {
    const stamp = ++this.stamp;
    const c = this.cell;
    const found: Occluder[] = [];
    for (let x = Math.floor(minX / c); x <= Math.floor(maxX / c); x++) {
      for (let y = Math.floor(minY / c); y <= Math.floor(maxY / c); y++) {
        const cell = this.cells.get(cellKey(x, y));
        if (cell === undefined) continue;
        for (const o of cell) {
          if (o.stamp === stamp) continue;
          o.stamp = stamp;
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
      const cell = this.cells.get(cellKey(cx, cy));
      if (cell !== undefined) {
        for (const o of cell) {
          if (o.stamp === stamp) continue;
          o.stamp = stamp;
          const lambda = segsHit(p, q, o.a, o.b);
          if (lambda !== -1 && fn(o, lambda) === true) return;
        }
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
  kind: "wall" | "door" | "window" | "obstacle" | "low" | "decor";
  id: number;
  top?: number;
  /** The walk that last met it — see `SegGrid.stamp` */
  stamp?: number;
};

/** A cell's key: one number, as a string key costs more than the walk itself. Cells span ±32768 */
const cellKey = (x: number, y: number) => (x + 32768) * 65536 + (y + 32768);
