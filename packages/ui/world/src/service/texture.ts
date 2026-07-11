import { geomService } from "@npc-cli/util/geom-service";
import { drawPolygons, drawRoundedRect } from "@npc-cli/util/service/canvas";
import * as THREE from "three/webgpu";
import type { DecorSheetEntry } from "../assets.schema";
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

  ct.fillStyle = "#000";
  ct.fillRect(0, 0, w, h);

  // 4 recessed panels with bevels
  for (const p of panels) {
    // ct.fillStyle = "rgba(255,255,255,0.03)";
    // ct.fillRect(panelInset, p.y, w - panelInset * 2, p.h);

    ct.strokeStyle = "rgba(160,180,200,0.05)";
    ct.lineWidth = 5;
    ct.strokeRect(panelInset, p.y, w - panelInset * 2, p.h);

    ct.strokeStyle = "rgba(180,200,220,0.1)";
    ct.lineWidth = 5;
    ct.beginPath();
    ct.moveTo(panelInset + 1, p.y + p.h);
    ct.lineTo(panelInset + 1, p.y + 1);
    ct.lineTo(w - panelInset - 1, p.y + 1);
    ct.stroke();

    ct.strokeStyle = "rgba(0,0,0,0.15)";
    ct.lineWidth = 5;
    ct.beginPath();
    ct.moveTo(w - panelInset - 1, p.y + 1);
    ct.lineTo(w - panelInset - 1, p.y + p.h - 1);
    ct.lineTo(panelInset + 1, p.y + p.h - 1);
    ct.stroke();
  }

  // // horizontal dividers between panels
  // ct.lineWidth = 20;
  // for (const lineY of [texH * 0.24, texH * 0.5, texH * 0.74]) {
  //   ct.strokeStyle = "rgba(160,180,200,0.1)";
  //   ct.beginPath();
  //   ct.moveTo(4, lineY);
  //   ct.lineTo(w - 4, lineY);
  //   ct.stroke();
  //   ct.strokeStyle = "rgba(0,0,0,0.5)";
  //   ct.beginPath();
  //   ct.moveTo(4, lineY + 2);
  //   ct.lineTo(w - 4, lineY + 2);
  //   ct.stroke();
  // }

  // rivets along edges
  for (const rx of [8, w - 8]) {
    for (let ry = 16; ry < h; ry += 28) {
      ct.fillStyle = "rgba(140,160,180,0.1)";
      ct.beginPath();
      ct.arc(rx, ry, 3, 0, Math.PI * 2);
      ct.fill();
      ct.fillStyle = "rgba(200,220,240,0.3)";
      ct.beginPath();
      ct.arc(rx - 0.5, ry - 0.5, 1.5, 0, Math.PI * 2);
      ct.fill();
    }
  }

  // outer border
  ct.strokeStyle = "rgba(160,180,200,0.1)";
  ct.lineWidth = 5;
  ct.strokeRect(0, 0, w, h);

  // corner accents
  ct.strokeStyle = "rgba(180,200,220,0.4)";
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

/**
 * We require a geomorph instance:
 * - we'll restrict Lights to rooms but `roomId` only available in instantiated decor.
 * - want to support dynamically added lights.
 */
export function getLightMetas(gm: Geomorph.LayoutInstance) {
  return gm.decor
    .filter((d): d is Geomorph.DecorCircle => d.type === "circle" && d.meta.light === true)
    .map((d) => ({ ...d.center, radius: d.radius, roomId: d.meta.roomId }));
}

export function drawLightsIntoTexture(ct: CanvasRenderingContext2D, gm: Geomorph.LayoutInstance) {
  const lights = getLightMetas(gm);
  if (lights.length === 0) return;

  // Auxiliary canvas: dark overlay with light holes punched out, then composited onto main
  const aux = document.createElement("canvas");
  aux.width = ct.canvas.width;
  aux.height = ct.canvas.height;
  const auxCt = aux.getContext("2d") as CanvasRenderingContext2D;
  auxCt.setTransform(ct.getTransform());
  auxCt.strokeStyle = "#f00";
  auxCt.lineWidth = 0.01;

  for (const [roomId, room] of gm.rooms.entries()) {
    // clip to room
    auxCt.save();
    drawPolygons(auxCt, room, { fillStyle: null, strokeStyle: null, clip: true });
    auxCt.fillStyle = "rgba(0,0,0,0.7)";
    auxCt.fill();

    // Punch out light circles with radial fade
    auxCt.globalCompositeOperation = "destination-out";
    for (const { x, y, radius } of lights.filter((l) => l.roomId === roomId)) {
      // 🔔 must transform from world coords to local geomorph coords
      const { x: cx, y: cy } = gm.inverseMatrix.transformPoint({ x, y });
      const grad = auxCt.createRadialGradient(cx, cy, 0, cx, cy, radius);
      grad.addColorStop(0, "rgba(0,0,0,1)");
      grad.addColorStop(0.5, "rgba(0,0,0,0.5)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      auxCt.fillStyle = grad;
      auxCt.beginPath();
      auxCt.arc(cx, cy, radius, 0, Math.PI * 2);
      auxCt.fill();
      // auxCt.stroke();
    }

    auxCt.restore();
  }

  // Composite offscreen onto main canvas
  const transform = ct.getTransform();
  ct.resetTransform();
  ct.drawImage(aux, 0, 0);
  ct.setTransform(transform);
}

export function drawRoomOutlines(
  ct: CanvasRenderingContext2D,
  layout: Geomorph.Layout,
  floorTheme: { patternFill: string; tileStroke: string } = { patternFill: "#222", tileStroke: "#0001" },
) {
  ct.save();
  ct.lineJoin = "round";
  ct.lineCap = "round";
  ct.lineWidth = 0.08;
  ct.strokeStyle = "rgba(0, 0, 0, 1)";

  const insetAmount = 0.75;
  const pattern = getFloorPattern(floorTheme.patternFill, floorTheme.tileStroke);

  for (const room of layout.rooms) {
    // outline looks bad in small rooms
    if (room.rect.area < 10) continue;
    const noHoles = room.clone().removeHoles();
    pattern.setTransform(new DOMMatrix().scaleSelf(1 / worldToCanvas, 1 / worldToCanvas));
    ct.fillStyle = pattern;
    fillRoundedPolys(ct, geomService.createInset(noHoles, insetAmount), insetAmount);
  }
  ct.restore();
}

function fillRoundedPolys(ct: CanvasRenderingContext2D, polys: Geom.Poly[], cornerRadius: number) {
  for (const poly of polys) {
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
    if (pts.length < 3) continue;
    ct.beginPath();
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const prev = pts[(i - 1 + n) % n];
      const curr = pts[i];
      const next = pts[(i + 1) % n];
      const toPrevX = prev.x - curr.x,
        toPrevY = prev.y - curr.y;
      const toNextX = next.x - curr.x,
        toNextY = next.y - curr.y;
      const lenPrev = Math.hypot(toPrevX, toPrevY);
      const lenNext = Math.hypot(toNextX, toNextY);
      const r = Math.min(cornerRadius, lenPrev / 2, lenNext / 2);
      const ax = curr.x + (toPrevX / lenPrev) * r;
      const ay = curr.y + (toPrevY / lenPrev) * r;
      const bx = curr.x + (toNextX / lenNext) * r;
      const by = curr.y + (toNextY / lenNext) * r;
      if (i === 0) ct.moveTo(ax, ay);
      else ct.lineTo(ax, ay);
      ct.quadraticCurveTo(curr.x, curr.y, bx, by);
    }
    ct.closePath();
    ct.stroke();
    ct.fill();
  }
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

export function drawDoorLabelLayer(texArray: TexArray, layerIndex: number, label: string) {
  const { ct } = texArray;
  ct.clearRect(0, 0, texW, texH);
  ct.drawImage((basePanelCanvas ??= drawDoorBasePanel()), 0, 0);

  if (label !== "") {
    const logoY = (panels[2].y + panels[2].h / 2 + panels[3].y) / 2;
    ct.save();
    ct.translate(texW / 2, logoY);
    ct.scale(1, -1);
    ct.font = "36px sans-serif";
    ct.textAlign = "center";
    ct.textBaseline = "middle";
    ct.globalAlpha = 0.5;

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
      fillStyle: "rgba(30, 30, 30, 255)",
      strokeStyle: "rgba(220, 220, 220, 0.22)",
      lineWidth: 3,
    });

    ct.fillStyle = "#fff";
    ct.fillText(label, 0, 0);
    ct.restore();
  }

  texArray.updateIndex(layerIndex);
}

export const doorIconKeys = ["dharma-wheel", "endless-knot"] as const;

export function drawDoorIconLayer(
  texArray: TexArray,
  layerIndex: number,
  sheetImage: HTMLImageElement,
  entry: DecorSheetEntry,
) {
  const { ct } = texArray;
  ct.clearRect(0, 0, texW, texH);
  ct.drawImage((basePanelCanvas ??= drawDoorBasePanel()), 0, 0);

  const logoY = (panels[2].y + panels[2].h / 2 + panels[3].y) / 2;
  const iconSize = 100;
  const { rect } = entry;
  ct.save();
  ct.translate(texW / 2, logoY);
  ct.scale(1, -1);

  ct.globalAlpha = 0.5;
  drawRoundedRect(ct, {
    x: -iconSize / 2,
    y: -iconSize / 2,
    width: iconSize,
    height: iconSize,
    radius: 6,
    fillStyle: "rgba(30, 30, 30, 0.5)",
    strokeStyle: "rgba(220, 220, 220, 0.22)",
    lineWidth: 3,
  });

  ct.globalAlpha = 0.25;
  ct.drawImage(sheetImage, rect.x, rect.y, rect.width, rect.height, -iconSize / 2, -iconSize / 2, iconSize, iconSize);
  ct.restore();

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
