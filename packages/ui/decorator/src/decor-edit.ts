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
  const scale = Math.hypot(at.x - def.x, at.y - def.y) / half;
  return { ...def, scale: Math.max(minScale, step === undefined ? scale : Math.round(scale / step) * step) };
}

export function circleResized(def: CircleDef, at: Geom.VectJson, step?: number): CircleDef {
  return { ...def, radius: sized(Math.hypot(at.x - def.center.x, at.y - def.center.y), step) };
}

/** No smaller than `minSize`, and a multiple of `step` when given */
function sized(length: number, step?: number) {
  return Math.max(minSize, step === undefined ? length : Math.round(length / step) * step);
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
      return { type, key, x: at.x, y: at.y, img: opts.img, meta };
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
        y3d: opts.tilt ? tiltedQuadHeight : undefined,
        transform: [1, 0, 0, 1, at.x - size.width / 2, at.y - size.height / 2],
        meta: opts.tilt ? { ...meta, tilt: true } : meta,
      };
    }
  }
}

export type NewDefOpts = { img?: string; tilt?: boolean };

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

/** Metres: a resize stops here */
const minSize = 0.1;
const minScale = 0.1;
export const defaultQuadImg = "screen-0";
/** Where a tilted quad's top sits, as the symbols' screens do */
export const tiltedQuadHeight = 1.35;
