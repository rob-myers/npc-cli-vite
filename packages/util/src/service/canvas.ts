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

/**
 * `drawPolygons`' fill with hard edges: a pixel takes `fillStyle` whole, or is left as it was.
 *
 * The canvas softens a fill's edge, and over another fill that blends the two colours into a third.
 * So each polygon is drawn alone on a scratch canvas, and a pixel is its own if at least half covered.
 * `fillStyle` must be opaque. `ct`'s transform is used, and only each polygon's bounding box is read
 */
export function drawPolygonsCrisp(
  ct: CanvasRenderingContext2D,
  polys: Geom.Poly | Geom.Poly[],
  { fillStyle }: { fillStyle: string },
) {
  polys = Array.isArray(polys) ? polys : [polys];
  const { width, height } = ct.canvas;
  if (crispScratch === null || crispScratch.canvas.width !== width || crispScratch.canvas.height !== height) {
    const canvas = Object.assign(document.createElement("canvas"), { width, height });
    crispScratch = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
  }
  const scratch = crispScratch;
  const matrix = ct.getTransform();

  // the colour as the canvas stores it, off one whole pixel of it
  scratch.resetTransform();
  scratch.fillStyle = fillStyle;
  scratch.fillRect(0, 0, 1, 1);
  const colour = scratch.getImageData(0, 0, 1, 1, { colorSpace: "srgb" }).data;
  scratch.clearRect(0, 0, 1, 1);

  for (const poly of polys) {
    const { x, y, width: w, height: h } = poly.rect;
    const corners = [
      [x, y],
      [x + w, y],
      [x, y + h],
      [x + w, y + h],
    ].map(([cx, cy]) => matrix.transformPoint({ x: cx, y: cy }));
    const x0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x))) - 1);
    const y0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y))) - 1);
    const x1 = Math.min(width, Math.ceil(Math.max(...corners.map((p) => p.x))) + 1);
    const y1 = Math.min(height, Math.ceil(Math.max(...corners.map((p) => p.y))) + 1);
    if (x1 <= x0 || y1 <= y0) continue;

    scratch.resetTransform();
    scratch.clearRect(x0, y0, x1 - x0, y1 - y0);
    scratch.setTransform(matrix);
    drawPolygons(scratch, [poly], { fillStyle, strokeStyle: null });

    const cover = scratch.getImageData(x0, y0, x1 - x0, y1 - y0, { colorSpace: "srgb" }).data;
    const image = ct.getImageData(x0, y0, x1 - x0, y1 - y0, { colorSpace: "srgb" });
    for (let i = 0; i < cover.length; i += 4) if (cover[i + 3] >= 128) image.data.set(colour, i);
    ct.putImageData(image, x0, y0);
  }
}

/** `drawPolygonsCrisp`' own, as large as the canvas last drawn to */
let crispScratch: null | CanvasRenderingContext2D = null;

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
