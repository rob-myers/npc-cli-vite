/// <reference lib="dom" />

export function drawRoundedRect(
  ct: CanvasRenderingContext2D,
  opts: Geom.RectJson & {
    radius?: number;
    fillStyle?: string | CanvasPattern | null;
    strokeStyle?: string | null;
    lineWidth?: number | null;
  },
) {
  ct.fillStyle = opts.fillStyle ?? ct.fillStyle;
  ct.strokeStyle = opts.strokeStyle ?? ct.strokeStyle;
  ct.lineWidth = opts.lineWidth ?? ct.lineWidth;
  ct.beginPath();
  ct.roundRect(opts.x, opts.y, opts.width, opts.height, opts.radius ?? 0);
  if (opts.fillStyle !== null) ct.fill();
  if (opts.strokeStyle !== null) ct.stroke();
}

export function drawPolygons(
  ct: CanvasRenderingContext2D,
  polys: Geom.Poly | Geom.Poly[],
  {
    clip,
    fillStyle,
    strokeStyle,
    lineWidth,
  }: {
    clip?: boolean;
    fillStyle?: string | CanvasPattern | null;
    strokeStyle?: string | null;
    lineWidth?: number | null;
  } = {},
) {
  polys = Array.isArray(polys) ? polys : [polys];
  ct.fillStyle = fillStyle ?? ct.fillStyle;
  ct.strokeStyle = strokeStyle ?? ct.strokeStyle;
  ct.lineWidth = lineWidth ?? ct.lineWidth;
  for (const poly of polys) {
    ct.beginPath();
    fillRing(ct, poly.outline, false);
    for (const hole of poly.holes) {
      fillRing(ct, hole, false);
    }
    ct.closePath();
    if (strokeStyle !== null) {
      ct.stroke();
    }
    if (fillStyle !== null) {
      clip === true ? ct.clip() : ct.fill();
    }
  }
}

/** `polys` as one `Path2D`, to clip to all of them at once — `ct.clip` INTERSECTS */
export function getPolysPath(polys: Geom.Poly[]): Path2D {
  const path = new Path2D();
  for (const poly of polys) {
    for (const ring of [poly.outline, ...poly.holes]) {
      if (ring.length === 0) continue;
      path.moveTo(ring[0].x, ring[0].y);
      for (const p of ring) path.lineTo(p.x, p.y);
      path.closePath();
    }
  }
  return path;
}

/**
 * A soft dark edge inside `clipTo`: `edge` stroked blurred, the clip keeping its inner half. The two
 * differ for a doorway, darkened by an outline that runs through it.
 *
 * `blurPx` is in CANVAS pixels whatever the transform; `lineWidth` is in user units
 */
export function drawBlurredEdge(
  ct: CanvasRenderingContext2D,
  clipTo: Geom.Poly | Path2D,
  edge: Geom.Poly | Geom.Poly[] | Path2D,
  { blurPx, lineWidth, strokeStyle }: { blurPx: number; lineWidth: number; strokeStyle: string },
) {
  ct.save();
  ct.clip(clipTo instanceof Path2D ? clipTo : getPolysPath([clipTo]));
  ct.filter = `blur(${blurPx}px)`;
  if (edge instanceof Path2D) {
    ct.lineWidth = lineWidth;
    ct.strokeStyle = strokeStyle;
    ct.stroke(edge);
  } else {
    drawPolygons(ct, edge, { fillStyle: null, strokeStyle, lineWidth });
  }
  ct.restore();
}

export function fillRing(ct: CanvasRenderingContext2D, ring: Geom.VectJson[], fill = true) {
  if (ring.length) {
    ct.moveTo(ring[0].x, ring[0].y);
    ring.forEach((p) => ct.lineTo(p.x, p.y));
    fill && ct.fill();
    ct.closePath();
  }
}
