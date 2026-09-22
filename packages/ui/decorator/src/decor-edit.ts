import type { WorldState } from "@npc-cli/ui__world";
import { sguToWorldScale } from "@npc-cli/ui__world/const.env";
import { CircleIcon, type Icon, MapPinIcon, MonitorIcon, RectangleIcon } from "@phosphor-icons/react";

/** Pure helpers over decor defs, for the panel's editing. Every change ends in `w.decor.create` */

export type DecorType = Geomorph.DecorDef["type"];

export const typeIcon: Record<DecorType, Icon> = {
  point: MapPinIcon,
  rect: RectangleIcon,
  circle: CircleIcon,
  quad: MonitorIcon,
};

/** A def's anchor: where a drag or a nudge moves */
export function anchorOf(def: Geomorph.DecorDef): Geom.VectJson {
  switch (def.type) {
    case "point":
      return { x: def.x, y: def.y };
    case "rect":
      return { x: def.x, y: def.y };
    case "circle":
      return def.center;
    case "quad":
      return { x: def.transform?.[4] ?? 0, y: def.transform?.[5] ?? 0 };
  }
}

export function moved(def: Geomorph.DecorDef, dx: number, dy: number): Geomorph.DecorDef {
  switch (def.type) {
    case "point":
      return { ...def, x: def.x + dx, y: def.y + dy };
    case "rect":
      return { ...def, x: def.x + dx, y: def.y + dy };
    case "circle":
      return { ...def, center: { x: def.center.x + dx, y: def.center.y + dy } };
    case "quad": {
      const t = def.transform ?? [1, 0, 0, 1, 0, 0];
      return { ...def, transform: [t[0], t[1], t[2], t[3], t[4] + dx, t[5] + dy] };
    }
  }
}

type RectDef = Extract<Geomorph.DecorDef, { type: "rect" }>;
type CircleDef = Extract<Geomorph.DecorDef, { type: "circle" }>;

/** A rect's corners in world, from its own `x y` round by `angle` — as `Decor` lays it out */
export function rectCorners(def: RectDef): Geom.VectJson[] {
  const { cos, sin } = trig(def.angle ?? 0);
  const local = [
    [0, 0],
    [def.width, 0],
    [def.width, def.height],
    [0, def.height],
  ];
  return local.map(([lx, ly]) => ({ x: def.x + cos * lx - sin * ly, y: def.y + sin * lx + cos * ly }));
}

/** The rect with corner `i` dragged to `at`, the corner opposite staying put; sides to `step` */
export function rectResized(def: RectDef, i: number, at: Geom.VectJson, step?: number): RectDef {
  const { cos, sin } = trig(def.angle ?? 0);
  // into the rect's own frame, where the opposite corner and the drag bound the new rect
  const dx = at.x - def.x;
  const dy = at.y - def.y;
  const p = { x: cos * dx + sin * dy, y: -sin * dx + cos * dy };
  const o = [
    { x: def.width, y: def.height },
    { x: 0, y: def.height },
    { x: 0, y: 0 },
    { x: def.width, y: 0 },
  ][i];
  const width = sized(Math.abs(p.x - o.x), step);
  const height = sized(Math.abs(p.y - o.y), step);
  const minX = p.x < o.x ? o.x - width : o.x;
  const minY = p.y < o.y ? o.y - height : o.y;
  return {
    ...def,
    x: def.x + cos * minX - sin * minY,
    y: def.y + sin * minX + cos * minY,
    width,
    height,
  };
}

/** The rect at `angle` radians about its centre, normalised to (-π, π] */
export function rectTurned(def: RectDef, angle: number): RectDef {
  const c = rectCentre(def);
  const a = Math.atan2(Math.sin(angle), Math.cos(angle));
  const { cos, sin } = trig(a);
  const [hw, hh] = [def.width / 2, def.height / 2];
  return { ...def, angle: a, x: c.x - (cos * hw - sin * hh), y: c.y - (sin * hw + cos * hh) };
}

/** A quad's corners in world, its top edge first — its image through its `transform` */
export function quadCorners(w: WorldState, def: QuadDef): Geom.VectJson[] {
  const { width, height } = imgSize(w, def.img) ?? { width: 1, height: 1 };
  const [a, b, c, d, e, f] = def.transform ?? identity;
  return [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ].map(([lx, ly]) => ({ x: a * lx + c * ly + e, y: b * lx + d * ly + f }));
}

/** Its rotate handle and the top edge's middle it hangs off, else `null` for a type that cannot turn */
export function rotateHandle(w: WorldState, def: Geomorph.DecorDef): { from: Geom.VectJson; at: Geom.VectJson } | null {
  const corners = def.type === "rect" ? rectCorners(def) : def.type === "quad" ? quadCorners(w, def) : null;
  if (corners === null) return null;
  const from = mid(corners[0], corners[1]);
  const bottom = mid(corners[2], corners[3]); // "up" is away from it, whatever a transform's scale or flip
  const len = Math.hypot(from.x - bottom.x, from.y - bottom.y) || 1;
  const k = rotateGap / len;
  return { from, at: { x: from.x + (from.x - bottom.x) * k, y: from.y + (from.y - bottom.y) * k } };
}

/** Radians its top faces, clockwise from map "up" (-y) */
export function angleOf(w: WorldState, def: RectDef | QuadDef): number {
  if (def.type === "rect") return def.angle ?? 0;
  const [p, , , q] = quadCorners(w, def); // top-left, bottom-left
  return Math.atan2(p.y - q.y, p.x - q.x) + Math.PI / 2;
}

/** Turned about its centre so that its top faces `at`, to a multiple of `step` radians when given */
export function rotated<T extends RectDef | QuadDef>(w: WorldState, def: T, at: Geom.VectJson, step?: number): T {
  const c = centreOf(w, def);
  return turned(w, def, snap(Math.atan2(at.y - c.y, at.x - c.x) + Math.PI / 2, step));
}

/** Turned about its centre so that its top faces `angle` radians */
export function turned<T extends RectDef | QuadDef>(w: WorldState, def: T, angle: number): T {
  if (def.type === "rect") return rectTurned(def, angle) as T;
  const quad = def as QuadDef;
  const { cos, sin } = trig(angle - angleOf(w, quad));
  return quadAbout(quad, centreOf(w, quad), [cos, -sin, sin, cos]) as T;
}

/** The quad through the linear map `[m00, m01, m10, m11]` about `pivot`, which stays put */
function quadAbout(def: QuadDef, pivot: Geom.VectJson, [m00, m01, m10, m11]: number[]): QuadDef {
  const map = (x: number, y: number) => [m00 * x + m01 * y, m10 * x + m11 * y];
  const [a, b, c, d, e, f] = def.transform ?? identity;
  const [e2, f2] = map(e - pivot.x, f - pivot.y);
  const transform = [...map(a, b), ...map(c, d), e2 + pivot.x, f2 + pivot.y].map(tidy) as Geom.SixTuple;
  return { ...def, transform };
}

function topMidOf(w: WorldState, def: QuadDef): Geom.VectJson {
  const [p, q] = quadCorners(w, def);
  return mid(p, q);
}

function centreOf(w: WorldState, def: RectDef | QuadDef): Geom.VectJson {
  if (def.type === "rect") return rectCentre(def);
  const [p, , q] = quadCorners(w, def);
  return mid(p, q);
}

function rectCentre(def: RectDef): Geom.VectJson {
  const { cos, sin } = trig(def.angle ?? 0);
  const [hw, hh] = [def.width / 2, def.height / 2];
  return { x: def.x + cos * hw - sin * hh, y: def.y + sin * hw + cos * hh };
}

type PointDef = Extract<Geomorph.DecorDef, { type: "point" }>;

/** Where a point's image has its corner, turned by `orient`, for a handle to sit */
export function pointCorner(w: WorldState, def: PointDef): Geom.VectJson | null {
  const size = imgSize(w, def.img, def.scale);
  if (size === null) return null;
  const { cos, sin } = trig(((def.orient ?? 0) * Math.PI) / 180);
  const [lx, ly] = [size.width / 2, size.height / 2];
  return { x: def.x + cos * lx - sin * ly, y: def.y + sin * lx + cos * ly };
}

/** The point with its image's corner dragged to `at`: a scale, to `step` when given */
export function pointResized(w: WorldState, def: PointDef, at: Geom.VectJson, step?: number): PointDef {
  const size = imgSize(w, def.img);
  if (size === null) return def;
  const half = Math.hypot(size.width, size.height) / 2;
  return { ...def, scale: Math.max(minScale, snap(Math.hypot(at.x - def.x, at.y - def.y) / half, step)) };
}

/** A quad's scale on its image's own size: its transform's, taken as uniform */
export function quadScale(def: QuadDef): number {
  const [a, b, c, d] = def.transform ?? identity;
  return Math.sqrt(Math.abs(a * d - b * c));
}

/** The quad with its bottom-right corner dragged to `at`: scaled from its top line, to `step` when given */
export function quadResized(w: WorldState, def: QuadDef, at: Geom.VectJson, step?: number): QuadDef {
  const c = topMidOf(w, def);
  const corner = quadCorners(w, def)[2];
  const k = Math.hypot(at.x - c.x, at.y - c.y) / (Math.hypot(corner.x - c.x, corner.y - c.y) || 1);
  return quadScaled(w, def, snap(quadScale(def) * k, step));
}

/** The quad at `scale` on its image's own size, its top line's middle staying put — a tilt stands it up there */
export function quadScaled(w: WorldState, def: QuadDef, scale: number): QuadDef {
  const k = Math.max(minScale, scale) / (quadScale(def) || 1);
  return quadAbout(def, topMidOf(w, def), [k, 0, 0, k]);
}

export function circleResized(def: CircleDef, at: Geom.VectJson, step?: number): CircleDef {
  return { ...def, radius: sized(Math.hypot(at.x - def.center.x, at.y - def.center.y), step) };
}

/** No smaller than `minSize`, and a multiple of `step` when given */
function sized(length: number, step?: number) {
  return Math.max(minSize, snap(length, step));
}

/** To a multiple of `step` when given */
function snap(n: number, step?: number) {
  return step === undefined ? n : Math.round(n / step) * step;
}

function mid(p: Geom.VectJson, q: Geom.VectJson): Geom.VectJson {
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
}

/** Rounded, so a transform turned or scaled back and forth stays legible */
function tidy(n: number) {
  return Math.round(n * 1e6) / 1e6;
}

function trig(angle: number) {
  return { cos: Math.cos(angle), sin: Math.sin(angle) };
}

/** An image's size in metres, as `Decor` draws it */
export function imgSize(w: WorldState, img: string | undefined, scale = 1): { width: number; height: number } | null {
  const entry = img === undefined ? undefined : w.sheets?.decor[img];
  const s = sguToWorldScale * scale;
  return entry === undefined ? null : { width: entry.originalWidth * s, height: entry.originalHeight * s };
}

/** A new def of `type` at `at`, with sensible defaults, its image centred there */
export function newDef(
  w: WorldState,
  type: DecorType,
  key: string,
  at: Geom.VectJson,
  opts: NewDefOpts,
): Geomorph.DecorDef {
  const meta = { shown: true };
  switch (type) {
    case "point":
      return { type, key, x: at.x, y: at.y, img: opts.img, y3d: opts.y3d, meta };
    case "rect":
      return { type, key, x: at.x - 0.5, y: at.y - 0.5, width: 1, height: 1, meta };
    case "circle":
      return { type, key, center: at, radius: 0.5, meta };
    case "quad": {
      const img = opts.img ?? defaultQuadImg;
      const size = imgSize(w, img) ?? { width: 1, height: 1 };
      return {
        type,
        key,
        img,
        y3d: opts.y3d ?? (opts.tilt ? tiltedQuadHeight : undefined),
        transform: [1, 0, 0, 1, at.x - size.width / 2, at.y - size.height / 2],
        meta: opts.tilt ? { ...meta, tilt: true } : meta,
      };
    }
  }
}

export type NewDefOpts = { img?: string; tilt?: boolean; y3d?: number };

/** Only points and quads stand off the floor */
export function hasHeight(def: Geomorph.DecorDef): def is PointDef | QuadDef {
  return def.type === "point" || def.type === "quad";
}

export function withHeight(def: Geomorph.DecorDef, y3d: number | undefined): Geomorph.DecorDef {
  return hasHeight(def) ? { ...def, y3d } : def;
}

/** A tilt stands a quad up at `tiltedQuadHeight`, unless it was given a height of its own */
export function withTilt(def: QuadDef, tilt: boolean): QuadDef {
  const { tilt: _, ...meta } = def.meta ?? {};
  return tilt
    ? { ...def, y3d: def.y3d ?? tiltedQuadHeight, meta: { ...meta, tilt: true } }
    : { ...def, y3d: def.y3d === tiltedQuadHeight ? undefined : def.y3d, meta };
}

type QuadDef = Extract<Geomorph.DecorDef, { type: "quad" }>;

/** The first of `<type>-1`, `<type>-2`… not taken by any decor, static or runtime */
export function nextKey(w: WorldState, type: DecorType) {
  for (let i = 1; ; i++) if (!(`${type}-${i}` in w.decor.byKey)) return `${type}-${i}`;
}

/** Runtime decor whose bounds meet the rect */
export function keysWithin(w: WorldState, rect: Geom.RectJson): string[] {
  return Object.values(w.decor.runtime.byKey)
    .filter((d) => {
      const b = d.bounds;
      return (
        b.x < rect.x + rect.width && b.x + b.width > rect.x && b.y < rect.y + rect.height && b.y + b.height > rect.y
      );
    })
    .map((d) => d.key);
}

/** Client to map, off the SVG's own screen transform — which letterboxing does not fool */
export function toMap(svg: SVGSVGElement, clientX: number, clientY: number): Geom.VectJson {
  const ctm = svg.getScreenCTM();
  if (ctm === null) return { x: 0, y: 0 };
  const { x, y } = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  return { x, y };
}

const identity: Geom.SixTuple = [1, 0, 0, 1, 0, 0];
/** Metres: a rotate handle is this far beyond its decor's top edge */
const rotateGap = 0.3;
/** Metres: a resize stops here */
const minSize = 0.1;
const minScale = 0.1;
export const defaultQuadImg = "screen-0";
/** Where a tilted quad's top sits, as the symbols' screens do */
export const tiltedQuadHeight = 1.35;
