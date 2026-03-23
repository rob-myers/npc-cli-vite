// import type { CanvasRenderingContext2D } from "skia-canvas";
/// <reference lib="dom" />

export function drawPolygons(
  ct: CanvasRenderingContext2D,
  polys: Geom.Poly | Geom.Poly[],
  {
    clip,
    fillStyle,
    strokeStyle,
    lineWidth,
  }: { clip?: boolean; fillStyle?: string | null; strokeStyle?: string | null; lineWidth?: number | null } = {},
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
