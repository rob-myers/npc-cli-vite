import { geomService } from "@npc-cli/util/geom-service";
import { drawRoundedRect, getPolysPath } from "@npc-cli/util/service/canvas";
import * as THREE from "three/webgpu";
import { gmFloorExtraScale, worldToSguScale } from "../const";
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
};

/** One of `softEdges`' entries as `drawBlurredEdge` wants it, its blur in CANVAS pixels */
export function toEdgeOpts({ width, blur, ink }: (typeof softEdges)["roomEdge"]) {
  return { blurPx: blur * worldToCanvas, lineWidth: width, strokeStyle: ink };
}

/**
 * Everything the deck is drawn from, in ONE MUTABLE place: change a value from the console, call
 * `w.floor.drawAll()`, and it redraws — the plate pattern rebuilds itself when this changes.
 * Lengths are in METRES, since the canvas is already in world units (100 px/m)
 */
export const deckConfig = {
  /** The deck's own colour, under everything else */
  tone: "#2a2e33",

  /** One square plate of decking */
  plate: {
    shown: true,
    size: 1.5 / 2,
    /**
     * A seam is a dark groove PLUS a lit lip just beyond it — the pair is what reads as recessed
     * metal rather than a drawn line. Keep both at least two texels (0.02 m) wide, or they crawl
     */
    seamWidth: 0.03,
    seamInk: "rgba(0, 0, 0, 0.55)",
    lipWidth: 0.02,
    lipInk: "rgba(190, 205, 225, 0.16)",
  },

  /** A rivet at each plate corner, lit from the upper-left like the seams */
  rivet: {
    shown: true,
    radius: 0.03,
    inset: 0.09,
    ink: "rgba(0, 0, 0, 0.5)",
    lipInk: "rgba(205, 220, 240, 0.3)",
  },

  /** A line following the room's walls, held off them */
  outline: {
    shown: true,
    inset: 0.35,
    width: 0.025,
    ink: "rgba(190, 200, 210, 0.1)",
    /** Rooms below this (m²) get none: it would only crowd them */
    minRoomArea: 4,
  },

  /** The nav mesh over the deck — see `Floor`'s `drawNavMesh` */
  nav: {
    /** The walkable area, lifted a shade */
    fill: "rgba(255, 255, 255, 0.045)",
    ink: "rgba(120, 190, 235, 0.05)",
    /** Two texels at least, else it beats against every seam it crosses */
    lineWidth: 0.02,
  },
};

/** Every room's deck, the doorways between them, and a line inside each room's walls */
export function drawRoomFloors(ct: CanvasRenderingContext2D, layout: Geomorph.Layout) {
  ct.save();
  ct.lineJoin = "round";
  ct.lineCap = "round";

  // a doorway is not a room, and the deck reaches the bulkhead, so without this the structural
  // `hullFill` shows through between the decks either side
  for (const door of layout.doors) drawDeck(ct, door.poly);

  for (const room of layout.rooms) {
    drawDeck(ct, room);
    drawRoomOutline(ct, room);
  }

  ct.restore();
}

function drawDeck(ct: CanvasRenderingContext2D, poly: Geom.Poly) {
  const outline = poly.clone().removeHoles();
  const { rect } = outline;
  if (rect.width <= 0 || rect.height <= 0) return;

  ct.save();
  ct.clip(getPolysPath([outline]));

  ct.fillStyle = deckConfig.tone;
  ct.fillRect(rect.x, rect.y, rect.width, rect.height);

  if (deckConfig.plate.shown === true) {
    ct.fillStyle = getPlatePattern();
    ct.fillRect(rect.x, rect.y, rect.width, rect.height);
  }

  ct.restore();
}

function drawRoomOutline(ct: CanvasRenderingContext2D, room: Geom.Poly) {
  const { outline: opts } = deckConfig;
  if (opts.shown === false) return;

  const whole = room.clone().removeHoles();
  if (whole.rect.area < opts.minRoomArea) return;

  ct.save();
  ct.strokeStyle = opts.ink;
  ct.lineWidth = opts.width;
  for (const poly of geomService.createInset(whole, opts.inset)) {
    if (poly.outline.length < 3) continue;
    ct.beginPath();
    poly.outline.forEach((p, i) => (i === 0 ? ct.moveTo(p.x, p.y) : ct.lineTo(p.x, p.y)));
    ct.closePath();
    ct.stroke();
  }
  ct.restore();
}

let cachedPlate: null | { key: string; pattern: CanvasPattern } = null;

/** Rebuilt whenever `deckConfig` changes, so mutating it and redrawing is all it takes */
function getPlatePattern(): CanvasPattern {
  const key = JSON.stringify([deckConfig.plate, deckConfig.rivet]);
  if (cachedPlate === null || cachedPlate.key !== key) {
    cachedPlate = { key, pattern: createPlatePattern() };
  }
  // the pattern canvas is in PIXELS whilst `ct` is in metres
  cachedPlate.pattern.setTransform(new DOMMatrix().scaleSelf(1 / worldToCanvas, 1 / worldToCanvas));
  return cachedPlate.pattern;
}

function createPlatePattern(): CanvasPattern {
  const { plate, rivet } = deckConfig;
  const side = Math.max(1, Math.round(plate.size * worldToCanvas));
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

  // only the top and left edges: the plate to the right and the one below draw the others
  const seamPx = Math.max(1, Math.round(plate.seamWidth * worldToCanvas));
  const lipPx = Math.max(1, Math.round(plate.lipWidth * worldToCanvas));
  ctx.fillStyle = plate.seamInk;
  ctx.fillRect(0, 0, side, seamPx);
  ctx.fillRect(0, 0, seamPx, side);
  ctx.fillStyle = plate.lipInk;
  ctx.fillRect(0, seamPx, side, lipPx);
  ctx.fillRect(seamPx, 0, lipPx, side);

  if (rivet.shown === true) {
    const radius = rivet.radius * worldToCanvas;
    const inset = rivet.inset * worldToCanvas;
    // biome-ignore format: one rivet per plate corner
    for (const [x, y] of [[inset, inset], [side - inset, inset], [inset, side - inset], [side - inset, side - inset]]) {
      ctx.fillStyle = rivet.ink;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rivet.lipInk;
      ctx.beginPath();
      ctx.arc(x - radius * 0.28, y - radius * 0.28, radius * 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return ctx.createPattern(canvas, "repeat") as CanvasPattern;
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
