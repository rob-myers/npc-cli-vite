import { geomService } from "@npc-cli/util";
import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  float,
  modelWorldMatrix,
  output,
  positionLocal,
  texture as tslTexture,
  uniform,
  uv,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { geomorphGridMeters, gmFloorExtraScale, worldToSguScale } from "../const";
import { objectPick } from "./pick";
import type { TexArray } from "./tex-array";

const texW = 256;
const texH = 512;

export function createPanelAtlas() {
  const count = logos.length;
  const data = new Uint8Array(texW * texH * 4 * count);

  // draw base panel once, then stamp each logo variant
  const base = drawBasePanel();
  for (let i = 0; i < count; i++) {
    const canvas = document.createElement("canvas");
    canvas.width = texW;
    canvas.height = texH;
    const ct = canvas.getContext("2d") as CanvasRenderingContext2D;
    ct.drawImage(base, 0, 0);
    drawLogo(ct, logos[i]);
    data.set(ct.getImageData(0, 0, texW, texH).data, i * texW * texH * 4);
  }

  const atlas = new THREE.DataArrayTexture(data, texW, texH, count);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.needsUpdate = true;
  return { atlas, count };
}

/** Draw the shared door panel (everything except the per-door logo) */
function drawBasePanel() {
  const canvas = document.createElement("canvas");
  canvas.width = texW;
  canvas.height = texH;
  const ct = canvas.getContext("2d") as CanvasRenderingContext2D;
  const w = texW;
  const h = texH;

  ct.fillStyle = "#1a2230";
  ct.fillRect(0, 0, w, h);

  // vertical sheen
  const grad = ct.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(120,150,180,0.15)");
  grad.addColorStop(0.5, "rgba(0,0,0,0)");
  grad.addColorStop(1, "rgba(0,0,0,0.2)");
  ct.fillStyle = grad;
  ct.fillRect(0, 0, w, h);

  // fine horizontal score lines
  ct.strokeStyle = "rgba(160,180,200,0.2)";
  ct.lineWidth = 1;
  for (let y = 8; y < h; y += 12) {
    ct.beginPath();
    ct.moveTo(8, y);
    ct.lineTo(w - 8, y);
    ct.stroke();
  }

  // 4 recessed panels with bevels
  for (const p of panels) {
    ct.fillStyle = "rgba(255,255,255,0.06)";
    ct.fillRect(panelInset, p.y, w - panelInset * 2, p.h);

    ct.strokeStyle = "rgba(160,180,200,0.35)";
    ct.lineWidth = 1.5;
    ct.strokeRect(panelInset, p.y, w - panelInset * 2, p.h);

    ct.strokeStyle = "rgba(180,200,220,0.3)";
    ct.lineWidth = 1.5;
    ct.beginPath();
    ct.moveTo(panelInset + 1, p.y + p.h);
    ct.lineTo(panelInset + 1, p.y + 1);
    ct.lineTo(w - panelInset - 1, p.y + 1);
    ct.stroke();

    ct.strokeStyle = "rgba(0,0,0,0.35)";
    ct.lineWidth = 1.5;
    ct.beginPath();
    ct.moveTo(w - panelInset - 1, p.y + 1);
    ct.lineTo(w - panelInset - 1, p.y + p.h - 1);
    ct.lineTo(panelInset + 1, p.y + p.h - 1);
    ct.stroke();
  }

  // horizontal dividers between panels
  ct.lineWidth = 2;
  for (const lineY of [texH * 0.24, texH * 0.5, texH * 0.74]) {
    ct.strokeStyle = "rgba(160,180,200,0.3)";
    ct.beginPath();
    ct.moveTo(4, lineY);
    ct.lineTo(w - 4, lineY);
    ct.stroke();
    ct.strokeStyle = "rgba(0,0,0,0.4)";
    ct.beginPath();
    ct.moveTo(4, lineY + 2);
    ct.lineTo(w - 4, lineY + 2);
    ct.stroke();
  }

  // rivets along edges
  for (const rx of [8, w - 8]) {
    for (let ry = 16; ry < h; ry += 28) {
      ct.fillStyle = "rgba(140,160,180,0.35)";
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
  ct.strokeStyle = "rgba(160,180,200,0.5)";
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

/** Draw a logo with glow onto a panel canvas (in top half of door) */
function drawLogo(ct: CanvasRenderingContext2D, logo: LogoFn) {
  // top half of door = canvas panels 2-3 (DataArrayTexture flipY=false)
  const logoY = (panels[2].y + panels[2].h / 2 + panels[3].y) / 2;
  const logoR = Math.min(panels[2].h, texW - panelInset * 2) * 0.35;

  // circular border
  ct.strokeStyle = "rgba(180,220,255,0.5)";
  ct.lineWidth = 2.5;
  ct.beginPath();
  ct.arc(texW / 2, logoY, logoR + 10, 0, Math.PI * 2);
  ct.stroke();

  // glow pass
  ct.save();
  ct.shadowColor = "rgba(100,180,255,0.7)";
  ct.shadowBlur = 14;
  logo(ct, texW / 2, logoY, logoR);
  ct.restore();
  // crisp pass
  logo(ct, texW / 2, logoY, logoR);
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

// --- logo drawing ---

const logoColor = "#ffffff";
const logoLineWidth = 8;

type LogoFn = (ct: CanvasRenderingContext2D, cx: number, cy: number, r: number) => void;

function icon(fn: (ct: CanvasRenderingContext2D) => void): LogoFn {
  return (ct) => {
    ct.strokeStyle = logoColor;
    ct.fillStyle = logoColor;
    ct.lineWidth = logoLineWidth;
    ct.lineCap = "round";
    ct.lineJoin = "round";
    fn(ct);
  };
}

const logos: LogoFn[] = [
  // stateroom / bedroom
  (ct, cx, cy, r) =>
    icon(() => {
      ct.strokeRect(cx - r * 0.85, cy - r * 0.3, r * 1.7, r * 1.0);
      ct.beginPath();
      ct.roundRect(cx - r * 0.7, cy - r * 0.15, r * 0.55, r * 0.45, 4);
      ct.stroke();
      ct.beginPath();
      ct.moveTo(cx - r * 0.85, cy - r * 0.3);
      ct.lineTo(cx - r * 0.85, cy - r * 0.7);
      ct.lineTo(cx + r * 0.85, cy - r * 0.7);
      ct.lineTo(cx + r * 0.85, cy - r * 0.3);
      ct.stroke();
      ct.beginPath();
      ct.moveTo(cx - r * 0.85, cy + r * 0.7);
      ct.lineTo(cx - r * 0.85, cy + r * 0.85);
      ct.moveTo(cx + r * 0.85, cy + r * 0.7);
      ct.lineTo(cx + r * 0.85, cy + r * 0.85);
      ct.stroke();
    })(ct, cx, cy, r),
  // office — desk with monitor
  (ct, cx, cy, r) =>
    icon(() => {
      ct.strokeRect(cx - r * 0.5, cy - r * 0.8, r * 1.0, r * 0.7);
      ct.beginPath();
      ct.moveTo(cx, cy - r * 0.1);
      ct.lineTo(cx, cy + r * 0.15);
      ct.moveTo(cx - r * 0.3, cy + r * 0.15);
      ct.lineTo(cx + r * 0.3, cy + r * 0.15);
      ct.stroke();
      ct.beginPath();
      ct.moveTo(cx - r * 0.9, cy + r * 0.4);
      ct.lineTo(cx + r * 0.9, cy + r * 0.4);
      ct.moveTo(cx - r * 0.8, cy + r * 0.4);
      ct.lineTo(cx - r * 0.8, cy + r * 0.85);
      ct.moveTo(cx + r * 0.8, cy + r * 0.4);
      ct.lineTo(cx + r * 0.8, cy + r * 0.85);
      ct.stroke();
    })(ct, cx, cy, r),
  // study — open book
  (ct, cx, cy, r) =>
    icon(() => {
      ct.beginPath();
      ct.moveTo(cx, cy - r * 0.6);
      ct.quadraticCurveTo(cx - r * 0.9, cy - r * 0.5, cx - r * 0.9, cy + r * 0.4);
      ct.lineTo(cx, cy + r * 0.3);
      ct.stroke();
      ct.beginPath();
      ct.moveTo(cx, cy - r * 0.6);
      ct.quadraticCurveTo(cx + r * 0.9, cy - r * 0.5, cx + r * 0.9, cy + r * 0.4);
      ct.lineTo(cx, cy + r * 0.3);
      ct.stroke();
      ct.beginPath();
      ct.moveTo(cx, cy - r * 0.6);
      ct.lineTo(cx, cy + r * 0.3);
      ct.stroke();
      ct.lineWidth = 2;
      for (const ly of [0.15, 0.35, 0.55]) {
        ct.beginPath();
        ct.moveTo(cx - r * 0.7, cy - r * 0.3 + r * ly);
        ct.lineTo(cx - r * 0.15, cy - r * 0.25 + r * ly);
        ct.stroke();
      }
    })(ct, cx, cy, r),
  // deck / bridge — ship wheel
  (ct, cx, cy, r) =>
    icon(() => {
      ct.beginPath();
      ct.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
      ct.stroke();
      ct.beginPath();
      ct.arc(cx, cy, r * 0.25, 0, Math.PI * 2);
      ct.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i;
        ct.beginPath();
        ct.moveTo(cx + r * 0.25 * Math.cos(a), cy + r * 0.25 * Math.sin(a));
        ct.lineTo(cx + r * 0.8 * Math.cos(a), cy + r * 0.8 * Math.sin(a));
        ct.stroke();
      }
    })(ct, cx, cy, r),
  // engineering — gear/cog
  (ct, cx, cy, r) =>
    icon(() => {
      const teeth = 8;
      const outer = r * 0.85;
      const inner = r * 0.6;
      ct.beginPath();
      for (let i = 0; i < teeth; i++) {
        const a1 = ((Math.PI * 2) / teeth) * i - Math.PI / 2;
        const a2 = a1 + (Math.PI / teeth) * 0.5;
        const a3 = a1 + Math.PI / teeth;
        const a4 = a1 + (Math.PI / teeth) * 1.5;
        ct.lineTo(cx + outer * Math.cos(a1), cy + outer * Math.sin(a1));
        ct.lineTo(cx + outer * Math.cos(a2), cy + outer * Math.sin(a2));
        ct.lineTo(cx + inner * Math.cos(a3), cy + inner * Math.sin(a3));
        ct.lineTo(cx + inner * Math.cos(a4), cy + inner * Math.sin(a4));
      }
      ct.closePath();
      ct.stroke();
      ct.beginPath();
      ct.arc(cx, cy, r * 0.2, 0, Math.PI * 2);
      ct.stroke();
    })(ct, cx, cy, r),
  // medical — cross
  (ct, cx, cy, r) =>
    icon(() => {
      const a = r * 0.3;
      ct.beginPath();
      ct.moveTo(cx - a, cy - r * 0.8);
      ct.lineTo(cx + a, cy - r * 0.8);
      ct.lineTo(cx + a, cy - a);
      ct.lineTo(cx + r * 0.8, cy - a);
      ct.lineTo(cx + r * 0.8, cy + a);
      ct.lineTo(cx + a, cy + a);
      ct.lineTo(cx + a, cy + r * 0.8);
      ct.lineTo(cx - a, cy + r * 0.8);
      ct.lineTo(cx - a, cy + a);
      ct.lineTo(cx - r * 0.8, cy + a);
      ct.lineTo(cx - r * 0.8, cy - a);
      ct.lineTo(cx - a, cy - a);
      ct.closePath();
      ct.stroke();
    })(ct, cx, cy, r),
  // mess / galley — fork and knife
  (ct, cx, cy, r) =>
    icon(() => {
      const fx = cx - r * 0.3;
      ct.beginPath();
      ct.moveTo(fx, cy + r * 0.8);
      ct.lineTo(fx, cy - r * 0.1);
      ct.stroke();
      for (const dx of [-r * 0.15, 0, r * 0.15]) {
        ct.beginPath();
        ct.moveTo(fx + dx, cy - r * 0.1);
        ct.lineTo(fx + dx, cy - r * 0.7);
        ct.stroke();
      }
      const kx = cx + r * 0.3;
      ct.beginPath();
      ct.moveTo(kx, cy + r * 0.8);
      ct.lineTo(kx, cy - r * 0.1);
      ct.stroke();
      ct.beginPath();
      ct.moveTo(kx, cy - r * 0.1);
      ct.lineTo(kx + r * 0.18, cy - r * 0.5);
      ct.lineTo(kx, cy - r * 0.75);
      ct.stroke();
    })(ct, cx, cy, r),
  // bathroom / toilet
  (ct, cx, cy, r) =>
    icon(() => {
      ct.beginPath();
      ct.ellipse(cx, cy + r * 0.1, r * 0.5, r * 0.65, 0, 0, Math.PI * 2);
      ct.stroke();
      ct.strokeRect(cx - r * 0.45, cy - r * 0.85, r * 0.9, r * 0.35);
      ct.beginPath();
      ct.arc(cx, cy - r * 0.67, r * 0.08, 0, Math.PI * 2);
      ct.fill();
      ct.beginPath();
      ct.ellipse(cx, cy + r * 0.1, r * 0.35, r * 0.5, 0, 0, Math.PI * 2);
      ct.stroke();
    })(ct, cx, cy, r),
];

// --- floor texture ---

export const worldToCanvas = worldToSguScale * gmFloorExtraScale;

export function drawRoomOutlines(ct: CanvasRenderingContext2D, layout: Geomorph.Layout) {
  ct.save();
  ct.lineJoin = "round";
  ct.lineCap = "round";
  ct.lineWidth = 0.08;
  ct.strokeStyle = "rgba(0, 0, 0, 1)";

  const insetAmount = 0.75;

  for (const room of layout.rooms) {
    const noHoles = room.clone().removeHoles();
    sciFiFloorPattern.setTransform(new DOMMatrix().scaleSelf(1 / worldToCanvas, 1 / worldToCanvas));
    ct.fillStyle = sciFiFloorPattern;
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

const sciFiFloorPattern = (() => {
  const tileWorld = geomorphGridMeters; // match grid
  const scale = worldToSguScale * gmFloorExtraScale;
  const size = Math.round(tileWorld * scale);
  const c = document.createElement("canvas");
  c.width = size * 2;
  c.height = size * 2;
  const s = c.width;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;

  // base dark metallic
  ctx.fillStyle = "rgba(20, 22, 28, 1)";
  ctx.fillRect(0, 0, s, s);

  // tile grid lines
  ctx.strokeStyle = "rgba(0, 200, 0, 0.2)";
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, size, size);
  ctx.strokeRect(size, 0, size, size);
  ctx.strokeRect(0, size, size, size);
  ctx.strokeRect(size, size, size, size);

  // inner tile bevels (inset lines)
  const m = 4;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.25)";
  ctx.lineWidth = 1;
  for (const [ox, oy] of [
    [0, 0],
    [size, 0],
    [0, size],
    [size, size],
  ]) {
    ctx.strokeRect(ox + m, oy + m, size - m * 2, size - m * 2);
  }

  // rivet dots in corners of each tile
  ctx.fillStyle = "rgba(0, 0, 0, 1)";
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

  return ctx.createPattern(c, "repeat") as CanvasPattern;
})();

export function drawLabelLayer(texArray: TexArray, layerIndex: number, npcKey: string) {
  const { ct } = texArray;
  const { width, height } = ct.canvas;
  ct.clearRect(0, 0, width, height);
  // ct.fillStyle = "rgba(0, 0, 0, 0.5)";
  // ct.roundRect(0, 0, width, height, 8);
  ct.fill();
  ct.fillStyle = "white";
  ct.font = "36px sans-serif";
  ct.textAlign = "center";
  ct.textBaseline = "middle";
  ct.fillText(npcKey, width / 2, height / 2);
  texArray.updateIndex(layerIndex);
}

export function createLabelMaterial(texArray: TexArray, layerIndex: number) {
  const texNode = tslTexture(texArray.tex);
  const layerNode = texNode.depth(uniform(layerIndex));
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: true,
    alphaTest: Number.EPSILON,
    side: THREE.DoubleSide,
  });
  mat.colorNode = layerNode;
  mat.opacityNode = layerNode.a;

  const offset = attribute("billboardOffset", "vec2");
  const worldCenter = modelWorldMatrix.mul(vec4(positionLocal, 1));
  const viewCenter = cameraViewMatrix.mul(worldCenter);
  const viewPos = viewCenter.add(vec4(offset, 0, 0));
  mat.vertexNode = cameraProjectionMatrix.mul(viewPos);

  return mat;
}

export function createShadowMaterial() {
  const center = uv().sub(0.5);
  const dist = center.dot(center).mul(4);
  const alpha = float(1).sub(dist).clamp(0, 1);
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, opacity: 1, depthWrite: false });
  mat.colorNode = vec4(0, 0, 0, 1);
  mat.opacityNode = alpha.mul(0.6);
  // could also set a special colour preventing close clicks
  mat.outputNode = objectPick.equal(1).select(vec4(0, 0, 0, 0), output);
  return mat;
}
