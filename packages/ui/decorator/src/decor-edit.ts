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

/** An image's size in metres, as `Decor` draws it */
export function imgSize(w: WorldState, img: string | undefined): { width: number; height: number } | null {
  const entry = img === undefined ? undefined : w.sheets?.decor[img];
  return entry === undefined
    ? null
    : { width: entry.originalWidth * sguToWorldScale, height: entry.originalHeight * sguToWorldScale };
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

export const defaultQuadImg = "screen-0";
/** Where a tilted quad's top sits, as the symbols' screens do */
export const tiltedQuadHeight = 1.35;
