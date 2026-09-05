import { Poly, Rect } from "@npc-cli/util/geom";
import { geomService } from "@npc-cli/util/geom-service";
import { drawBlurredEdge, drawRoundedRect } from "@npc-cli/util/service/canvas";
import * as THREE from "three/webgpu";
import { geomorphGridMeters, gmFloorExtraScale, worldToSguScale } from "../const";
import type { TexArray } from "./tex-array";

const texW = 256;
const texH = 512;

/** Draw the shared door panel (everything except the per-door label) */
function drawDoorBasePanel() {
  const canvas = document.createElement("canvas");
  canvas.width = texW;
  canvas.height = texH;
  const ct = canvas.getContext("2d") as CanvasRenderingContext2D;
  const w = texW;
  const h = texH;

  // metal, not a silhouette: it needs an albedo of its own, the player light only ever tinting
  // what is here DOWN (see `service/player-light`) — near black would stay near black
  const base = ct.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, doorPanelTop);
  base.addColorStop(1, doorPanelBottom);
  ct.fillStyle = base;
  ct.fillRect(0, 0, w, h);

  // 4 recessed panels: sunk a shade below the face, then bevelled light over dark
  for (const p of panels) {
    ct.fillStyle = doorPanelRecess;
    ct.fillRect(panelInset, p.y, w - panelInset * 2, p.h);

    ct.strokeStyle = "rgba(150,170,190,0.25)";
    ct.lineWidth = 5;
    ct.strokeRect(panelInset, p.y, w - panelInset * 2, p.h);

    // top-left catches the light
    ct.strokeStyle = "rgba(205,225,245,0.35)";
    ct.lineWidth = 5;
    ct.beginPath();
    ct.moveTo(panelInset + 1, p.y + p.h);
    ct.lineTo(panelInset + 1, p.y + 1);
    ct.lineTo(w - panelInset - 1, p.y + 1);
    ct.stroke();

    // bottom-right falls into shadow
    ct.strokeStyle = "rgba(0,0,0,0.45)";
    ct.lineWidth = 5;
    ct.beginPath();
    ct.moveTo(w - panelInset - 1, p.y + 1);
    ct.lineTo(w - panelInset - 1, p.y + p.h - 1);
    ct.lineTo(panelInset + 1, p.y + p.h - 1);
    ct.stroke();
  }

  // rivets along edges
  for (const rx of [8, w - 8]) {
    for (let ry = 16; ry < h; ry += 28) {
      ct.fillStyle = "rgba(110,130,150,0.55)";
      ct.beginPath();
      ct.arc(rx, ry, 3, 0, Math.PI * 2);
      ct.fill();
      ct.fillStyle = "rgba(225,240,255,0.85)";
      ct.beginPath();
      ct.arc(rx - 0.5, ry - 0.5, 1.5, 0, Math.PI * 2);
      ct.fill();
    }
  }

  // outer border
  ct.strokeStyle = "rgba(160,180,200,0.35)";
  ct.lineWidth = 5;
  ct.strokeRect(0, 0, w, h);

  // corner accents
  ct.strokeStyle = "rgba(195,215,240,0.7)";
  ct.lineWidth = 3;
  for (const [cx, cy, sx, sy] of [
    [5, 5, 1, 1],
    [w - 5, 5, -1, 1],
    [5, h - 5, 1, -1],
    [w - 5, h - 5, -1, -1],
  ] as const) {
    ct.beginPath();
    ct.moveTo(cx, cy + cornerLen * sy);
    ct.lineTo(cx, cy);
    ct.lineTo(cx + cornerLen * sx, cy);
    ct.stroke();
  }

  return canvas;
}

// --- panel layout constants ---

/** The door's own colour, lit down from here by `player-light` — see `drawDoorBasePanel` */
const doorPanelTop = "#3f464e";
const doorPanelBottom = "#2f353b";
const doorPanelRecess = "#343a41";

const panelInset = 14;
const panels = [
  { y: 8, h: texH * 0.22 },
  { y: texH * 0.24 + 8, h: texH * 0.24 },
  { y: texH * 0.5 + 8, h: texH * 0.22 },
  { y: texH * 0.74 + 8, h: texH * 0.24 - 8 },
];
const cornerLen = 20;

// --- floor texture ---

export const worldToCanvas = worldToSguScale * gmFloorExtraScale;

/** The soft dark edges the floor is drawn with, whilst `Debug`'s `floorShading` is on. METRES */
export const softEdges = {
  /** Inside each room's outline, and each doorway's — see `Floor`'s `drawGm` */
  roomEdge: { width: 0.15, blur: 0.15, ink: "rgba(0, 0, 0, 0.45)" },
  /** Inside each floor panel — see `drawRoomOutlines` */
  outlineEdge: { width: 0.12, blur: 0.08, ink: "rgba(0, 0, 10, 0.8)" },
};

/** One of `softEdges`' entries as `drawBlurredEdge` wants it, its blur in CANVAS pixels */
export function toEdgeOpts({ width, blur, ink }: (typeof softEdges)["roomEdge"]) {
  return { blurPx: blur * worldToCanvas, lineWidth: width, strokeStyle: ink };
}

export function drawRoomOutlines(
  ct: CanvasRenderingContext2D,
  layout: Geomorph.Layout,
  floorTheme: { patternFill: string; tileStroke: string } = { patternFill: "#222", tileStroke: "#0001" },
  /** Whether each panel wears an inner shadow — see `Debug`'s `floorShading` */
  shading = true,
) {
  ct.save();
  ct.lineJoin = "round";
  ct.lineCap = "round";
  ct.lineWidth = 0.04;
  ct.strokeStyle = "rgba(0, 0, 0, 1)";

  const pattern = getFloorPattern(floorTheme.patternFill, floorTheme.tileStroke);
  const stripes = getStripePattern();
  stripes.setTransform(new DOMMatrix().scaleSelf(1 / worldToCanvas, 1 / worldToCanvas));

  for (const room of layout.rooms) {
    if (room.rect.area < 10) continue; // outline looks bad in small rooms
    pattern.setTransform(new DOMMatrix().scaleSelf(1 / worldToCanvas, 1 / worldToCanvas));
    ct.fillStyle = pattern;
    const { whole, pieces } = getRoomFloorPieces(room);
    fillRoundedPolys(ct, whole, floorInsetAmount);
    fillStraightPolys(ct, pieces);

    // the same panels again, filled with the hatch and stroked no second time — no inset, so the
    // stripes run right up to the outlines already drawn
    ct.fillStyle = stripes;
    fillRoundedPolys(ct, whole, floorInsetAmount, false);
    fillStraightPolys(ct, pieces, false);

    // an inner shadow on each, so a panel reads as raised. The ROUNDED path for `whole`, else it
    // traces corners the fill does not have
    if (shading === true) {
      const edge = toEdgeOpts(softEdges.outlineEdge);
      for (const path of whole.flatMap((p) => getRoundedPolyPath(p, floorInsetAmount) ?? [])) {
        drawBlurredEdge(ct, path, path, edge);
      }
      for (const piece of pieces) drawBlurredEdge(ct, piece, piece, edge);
    }
  }
  ct.restore();
}

/**
 * The polygons a room's floor is drawn as: the room inset, then anything sizeable cut into grid
 * pieces. Kept apart from the drawing so the inset and split numbers live in one place.
 */
export function getRoomFloorPieces(room: Geom.Poly) {
  const insetPolys = geomService.createInset(room.clone().removeHoles(), floorInsetAmount);
  // a curved room is left whole: a grid of rectangles inside it reads as a mistake
  const split = (p: Geom.Poly) => p.rect.area >= splitPolyMinArea && isCurved(p) === false;
  return {
    whole: insetPolys.filter((p) => split(p) === false),
    pieces: insetPolys
      .filter(split)
      .flatMap((p) => splitIntoGridPieces(p, gridPieceSize, gridPieceGap, gridSmallPieceFrac)),
  };
}

/** Curves arrive tessellated, so many SHORT edges is what tells one from a rectilinear room */
function isCurved(poly: Geom.Poly): boolean {
  const { outline } = poly;
  const short = outline.filter((p, i) => p.distanceTo(outline[(i + 1) % outline.length]) < curvedEdgeMax);
  return short.length >= curvedEdgeCount;
}

/** An edge this short (metres), and this many of them, means a curve rather than a corner */
const curvedEdgeMax = 0.5;
const curvedEdgeCount = 8;

const floorInsetAmount = 0.75;
const splitPolyMinArea = 20; // polygons at/above this area get split into grid pieces
const gridPieceSize = geomorphGridMeters * 2;
const gridPieceGap = 0.05;
const gridSmallPieceFrac = 0.3; // cells below this fraction of a full cell merge into a neighbour

/** The hatch over the panels: stripe pitch and width in METRES, so it lies on the world, and its ink */
const stripeGap = 0.14;
const stripeWidth = 0.05;
const stripeColor = "rgba(10, 10, 10, 0.15)";

let cachedStripePattern: null | CanvasPattern = null;

/**
 * Diagonal stripes, as a pattern rather than as lines drawn per panel — one small tile repeated
 * by the canvas, and `setTransform` puts its pitch in world metres. The tile is square and the
 * stripes run at 45°, which is what lets it repeat without a seam.
 */
function getStripePattern(): CanvasPattern {
  if (cachedStripePattern !== null) return cachedStripePattern;

  const scale = worldToSguScale * gmFloorExtraScale;
  const size = Math.round(stripeGap * scale);
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;

  ctx.strokeStyle = stripeColor;
  ctx.lineWidth = stripeWidth * scale;
  // three passes: the diagonal, and once either side of it, so the stripe crossing the tile's
  // corners is unbroken where the tile repeats
  for (const offset of [-size, 0, size]) {
    ctx.beginPath();
    ctx.moveTo(offset - size, size * 2);
    ctx.lineTo(offset + size * 2, -size);
    ctx.stroke();
  }

  cachedStripePattern = ctx.createPattern(c, "repeat") as CanvasPattern;
  return cachedStripePattern;
}

function fillStraightPolys(ct: CanvasRenderingContext2D, polys: Geom.Poly[], stroke = true) {
  for (const poly of polys) {
    if (poly.outline.length < 3) continue;
    ct.beginPath();
    poly.outline.forEach((p, i) => (i === 0 ? ct.moveTo(p.x, p.y) : ct.lineTo(p.x, p.y)));
    ct.closePath();
    stroke && ct.stroke();
    ct.fill();
  }
}

type GridCell = { gx: number; gy: number; rect: Rect; area: number };

/** Clip `poly` into a grid of pieces, merging slivers into a neighbour, then gap-shrink each piece */
function splitIntoGridPieces(poly: Geom.Poly, cellSize: number, gap: number, smallAreaFrac: number): Geom.Poly[] {
  const cells = computeGridCells(poly, cellSize);
  const rects = mergeSmallGridCells(cells, cellSize, smallAreaFrac);
  const pieces: Geom.Poly[] = [];
  for (const rect of rects) {
    const shrunk = Poly.fromRect(new Rect(rect.x + gap, rect.y + gap, rect.width - gap * 2, rect.height - gap * 2));
    pieces.push(...Poly.intersect([poly], [shrunk]).filter((piece) => piece.rect.area > 0.01));
  }
  return pieces;
}

/** Occupied (area > 0) cells of a `cellSize`-spaced grid covering `poly`'s bounds */
function computeGridCells(poly: Geom.Poly, cellSize: number): GridCell[] {
  const bounds = poly.rect;
  const gxMin = Math.floor(bounds.x / cellSize);
  const gxMax = Math.ceil((bounds.x + bounds.width) / cellSize);
  const gyMin = Math.floor(bounds.y / cellSize);
  const gyMax = Math.ceil((bounds.y + bounds.height) / cellSize);
  const cells: GridCell[] = [];
  for (let gx = gxMin; gx < gxMax; gx++) {
    for (let gy = gyMin; gy < gyMax; gy++) {
      const rect = new Rect(gx * cellSize, gy * cellSize, cellSize, cellSize);
      const area = Poly.intersect([poly], [Poly.fromRect(rect)]).reduce((sum, p) => sum + p.rect.area, 0);
      if (area > 0.01) cells.push({ gx, gy, rect, area });
    }
  }
  return cells;
}

/** Merge each small cell into one orthogonally-adjacent occupied cell, forming a 2-cell rect */
function mergeSmallGridCells(cells: GridCell[], cellSize: number, smallAreaFrac: number): Rect[] {
  const key = (gx: number, gy: number) => `${gx},${gy}`;
  const smallThreshold = cellSize * cellSize * smallAreaFrac;
  const byKey = new Map(cells.map((c) => [key(c.gx, c.gy), c]));
  const used = new Set<string>();
  const rects: Rect[] = [];
  const neighborOffsets = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;

  for (const cell of cells) {
    if (used.has(key(cell.gx, cell.gy)) || cell.area >= smallThreshold) continue;
    for (const [dx, dy] of neighborOffsets) {
      const neighbor = byKey.get(key(cell.gx + dx, cell.gy + dy));
      if (!neighbor || used.has(key(neighbor.gx, neighbor.gy))) continue;
      used.add(key(cell.gx, cell.gy));
      used.add(key(neighbor.gx, neighbor.gy));
      const minGx = Math.min(cell.gx, neighbor.gx);
      const minGy = Math.min(cell.gy, neighbor.gy);
      const w = (Math.max(cell.gx, neighbor.gx) - minGx + 1) * cellSize;
      const h = (Math.max(cell.gy, neighbor.gy) - minGy + 1) * cellSize;
      rects.push(new Rect(minGx * cellSize, minGy * cellSize, w, h));
      break;
    }
  }

  for (const cell of cells) {
    if (!used.has(key(cell.gx, cell.gy))) rects.push(cell.rect);
  }

  return rects;
}

function fillRoundedPolys(ct: CanvasRenderingContext2D, polys: Geom.Poly[], cornerRadius: number, stroke = true) {
  for (const path of polys.flatMap((poly) => getRoundedPolyPath(poly, cornerRadius) ?? [])) {
    stroke && ct.stroke(path);
    ct.fill(path);
  }
}

/** `poly` with rounded corners — the fill and its shadow share the path */
function getRoundedPolyPath(poly: Geom.Poly, cornerRadius: number): null | Path2D {
  // filter out points too close together so short edges don't prevent rounding
  const minDist = cornerRadius * 0.5;
  const pts: Geom.Vect[] = [];
  for (const p of poly.outline) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minDist) {
      pts.push(p);
    }
  }
  // also check last-to-first
  while (pts.length > 3 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < minDist) {
    pts.pop();
  }
  if (pts.length < 3) return null;

  const path = new Path2D();
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n];
    const curr = pts[i];
    const next = pts[(i + 1) % n];
    const toPrevX = prev.x - curr.x;
    const toPrevY = prev.y - curr.y;
    const toNextX = next.x - curr.x;
    const toNextY = next.y - curr.y;
    const lenPrev = Math.hypot(toPrevX, toPrevY);
    const lenNext = Math.hypot(toNextX, toNextY);
    const r = Math.min(cornerRadius, lenPrev / 2, lenNext / 2);
    const ax = curr.x + (toPrevX / lenPrev) * r;
    const ay = curr.y + (toPrevY / lenPrev) * r;
    const bx = curr.x + (toNextX / lenNext) * r;
    const by = curr.y + (toNextY / lenNext) * r;
    i === 0 ? path.moveTo(ax, ay) : path.lineTo(ax, ay);
    path.quadraticCurveTo(curr.x, curr.y, bx, by);
  }
  path.closePath();
  return path;
}

let cachedFloorPattern: CanvasPattern | null = null;
let cachedPatternFill = "";
let cachedTileStroke = "";

function getFloorPattern(patternFill: string, tileStroke: string): CanvasPattern {
  if (cachedFloorPattern && cachedPatternFill === patternFill && cachedTileStroke === tileStroke) {
    return cachedFloorPattern;
  }

  const tileWorld = geomorphGridMeters;
  const scale = worldToSguScale * gmFloorExtraScale;
  const size = Math.round(tileWorld * scale);
  const c = document.createElement("canvas");
  c.width = size * 2;
  c.height = size * 2;
  const s = c.width;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;

  ctx.fillStyle = patternFill;
  ctx.fillRect(0, 0, s, s);

  ctx.strokeStyle = tileStroke;
  ctx.lineWidth = 4;
  ctx.strokeRect(0, 0, size, size);
  ctx.strokeRect(size, 0, size, size);
  ctx.strokeRect(0, size, size, size);
  ctx.strokeRect(size, size, size, size);

  const m = 4;
  ctx.strokeStyle = tileStroke;
  ctx.lineWidth = 1;
  for (const [ox, oy] of [
    [0, 0],
    [size, 0],
    [0, size],
    [size, size],
  ]) {
    ctx.strokeRect(ox + m, oy + m, size - m * 2, size - m * 2);
  }

  ctx.fillStyle = tileStroke;
  const d = 6;
  for (const [ox, oy] of [
    [0, 0],
    [size, 0],
    [0, size],
    [size, size],
  ]) {
    for (const [rx, ry] of [
      [d, d],
      [size - d, d],
      [d, size - d],
      [size - d, size - d],
    ]) {
      ctx.beginPath();
      ctx.arc(ox + rx, oy + ry, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  cachedFloorPattern = ctx.createPattern(c, "repeat") as CanvasPattern;
  cachedPatternFill = patternFill;
  cachedTileStroke = tileStroke;
  return cachedFloorPattern;
}

export async function fetchSkinOverlay(svgPath: string, cacheBust: string): Promise<HTMLCanvasElement> {
  const svgText = await fetch(`/${svgPath}${cacheBust}`).then((r) => r.text());
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  for (const g of Array.from(doc.querySelectorAll("g"))) {
    const titleEl = g.querySelector(":scope > title");
    if (titleEl?.textContent?.trim() === "ignore") {
      g.remove();
    }
  }
  const svgBlob = new Blob([new XMLSerializer().serializeToString(doc.documentElement)], { type: "image/svg+xml" });
  const blobUrl = URL.createObjectURL(svgBlob);
  try {
    const img = await loadSvgImage(blobUrl);
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ct = canvas.getContext("2d") as CanvasRenderingContext2D;
    ct.imageSmoothingEnabled = false;
    ct.drawImage(img, 0, 0, 256, 256);
    return canvas;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function loadSvgImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

let basePanelCanvas: HTMLCanvasElement | null = null;

/** How strongly a door's label is drawn, against the part-transparent panel behind it */
const doorLabelAlpha = 0.9;

export function drawDoorLabelLayer(texArray: TexArray, layerIndex: number, label: string) {
  const { ct } = texArray;
  ct.clearRect(0, 0, texW, texH);
  ct.drawImage((basePanelCanvas ??= drawDoorBasePanel()), 0, 0);

  if (label !== "") {
    const logoY = (panels[2].y + panels[2].h / 2 + panels[3].y) / 2;
    ct.save();
    ct.translate(texW / 2, logoY);
    ct.scale(1, -1);
    ct.font = "32px sans-serif";
    ct.textAlign = "center";
    ct.textBaseline = "middle";
    // the PLATE only — the letters below get their own alpha
    ct.globalAlpha = doorLabelAlpha;

    const measured = ct.measureText(label);
    const padding = 12;
    const rw = measured.width + padding * 2;
    const rh = 36 + padding * 2;
    drawRoundedRect(ct, {
      x: -rw / 2,
      y: -rh / 2,
      width: rw,
      height: rh,
      radius: 6,
      fillStyle: "rgba(24, 24, 24, 255)",
      strokeStyle: "rgba(235, 235, 235, 0.34)",
      lineWidth: 3,
    });

    // white is the one value a colour-space round trip leaves alone, so the letters take it
    ct.globalAlpha = 1;
    ct.fillStyle = "#fff";
    ct.fillText(label, 0, 0);
    ct.restore();
  }

  texArray.updateIndex(layerIndex);
}

/**
 * TypeScript is having trouble:
 * >  error TS2590: Expression produces a union type that is too complex to represent.
 */
export type SelectFloatType = (
  x: THREE.Node<"bool">,
  y: THREE.Node<"float">,
  z: THREE.Node<"float">,
) => THREE.Node<"float">;

/**
 * TypeScript is having trouble:
 * >  error TS2590: Expression produces a union type that is too complex to represent.
 */
export type SelectAnyType = (x: THREE.Node<"bool">, y: THREE.Node, z: THREE.Node) => THREE.Node;

export function bootstrapInstanceColor(mesh: THREE.InstancedMesh | null) {
  if (mesh) {
    mesh.instanceColor ??= new THREE.InstancedBufferAttribute(new Float32Array(mesh.count * 3), 3);
    mesh.instanceColor.needsUpdate = true;
  }
}

const gridSize = 1.5;

export function drawFloorGrid(
  ct: CanvasRenderingContext2D,
  bounds: { x: number; y: number; width: number; height: number },
  gridOrigin: { x: number; y: number },
) {
  const ixMin = Math.floor(bounds.x / gridSize);
  const ixMax = Math.ceil((bounds.x + bounds.width) / gridSize);
  const iyMin = Math.floor(bounds.y / gridSize);
  const iyMax = Math.ceil((bounds.y + bounds.height) / gridSize);

  ct.strokeStyle = "rgba(220, 220, 220, 0.05)";
  ct.lineWidth = 0.012 * 4;
  ct.beginPath();
  for (let ix = ixMin; ix <= ixMax; ix++) {
    const x = ix * gridSize;
    ct.moveTo(x, iyMin * gridSize);
    ct.lineTo(x, iyMax * gridSize);
  }
  for (let iy = iyMin; iy <= iyMax; iy++) {
    const y = iy * gridSize;
    ct.moveTo(ixMin * gridSize, y);
    ct.lineTo(ixMax * gridSize, y);
  }
  ct.stroke();

  const worldOffsetX = gridOrigin.x;
  const worldOffsetY = gridOrigin.y;
  ct.fillStyle = "rgba(0, 220, 0, 0.85)";
  ct.font = "0.11px monospace";
  ct.textBaseline = "top";
  for (let ix = ixMin; ix < ixMax; ix++) {
    for (let iy = iyMin; iy < iyMax; iy++) {
      const wx = ix * gridSize + worldOffsetX;
      const wy = iy * gridSize + worldOffsetY;
      ct.fillText(`${wx}, ${wy}`, ix * gridSize + 0.04, iy * gridSize + 0.04);
    }
  }
}
