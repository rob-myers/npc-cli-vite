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

export function fillRing(ct: CanvasRenderingContext2D, ring: Geom.VectJson[], fill = true) {
  if (ring.length) {
    ct.moveTo(ring[0].x, ring[0].y);
    ring.forEach((p) => ct.lineTo(p.x, p.y));
    fill && ct.fill();
    ct.closePath();
  }
}
