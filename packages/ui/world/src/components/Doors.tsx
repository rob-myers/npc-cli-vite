import { useStateRef } from "@npc-cli/util";
import { Mat, Vect } from "@npc-cli/util/geom";
import { useContext, useEffect, useMemo } from "react";
import { float, instanceIndex, int, texture, uv } from "three/tsl";
import * as THREE from "three/webgpu";
import { WorldContext } from "./world-context";

export default function Doors() {
  const w = useContext(WorldContext);
  const doorCount = w.gmsData.count.door;

  const box = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);

  const state = useStateRef(
    (): State => ({
      inst: null,

      positionInstances() {
        const { inst } = state;
        if (!inst) return;

        let instanceId = 0;
        for (const { key: gmKey, transform, determinant } of w.gms) {
          tmpMat.setMatrixValue(transform);
          for (const door of w.gmsData.byKey[gmKey].doorSegs) {
            if (!("seg" in door)) continue; // stale HMR data
            const {
              seg: [u, v],
              hull,
            } = door;
            if (determinant > 0) {
              tmpV1.copy(v);
              tmpV2.copy(u);
            } else {
              tmpV1.copy(u);
              tmpV2.copy(v);
            }
            tmpMat.transformPoint(tmpV1);
            tmpMat.transformPoint(tmpV2);

            const dx = tmpV2.x - tmpV1.x - 0.01; // fix z-fighting
            const dz = tmpV2.y - tmpV1.y; // Vect.y → world Z
            const len = tmpV1.distanceTo(tmpV2);
            const nx = len > 0 ? dx / len : 1;
            const nz = len > 0 ? dz / len : 0;
            const mx = (tmpV1.x + tmpV2.x) / 2;
            const mz = (tmpV1.y + tmpV2.y) / 2;
            const depth = hull ? hullPanelDepth : panelDepth;

            // x-axis along door width, y-axis up, z-axis along panel depth
            // biome-ignore format: matrix layout
            tmpMat4.set(
              len * nx,  0,           -depth * nz,  mx,
              0,         doorHeight,   0,            doorHeight / 2,
              len * nz,  0,            depth * nx,   mz,
              0,         0,            0,            1,
            );
            inst.setMatrixAt(instanceId++, tmpMat4);
          }
        }

        inst.computeBoundingSphere();
        inst.instanceMatrix.needsUpdate = true;
      },
    }),
  );

  useEffect(() => {
    state.positionInstances();
  }, [w.mapKey, w.hash, w.gms.length]);

  // BoxGeometry groups: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z (front), 5 -z (back)
  const materials = useMemo(() => {
    const edge = new THREE.MeshStandardMaterial({ color: "#000000", metalness: 0.8, roughness: 0.3 });
    const top = new THREE.MeshStandardMaterial({ color: "#ffffff", metalness: 0.6, roughness: 0.3 });

    const { atlas, count } = createPanelAtlas();
    const panel = new THREE.MeshStandardNodeMaterial({
      metalness: 0.7,
      roughness: 0.25,
      side: THREE.DoubleSide,
      transparent: true,
    });
    const texNode = texture(atlas, uv());
    panel.colorNode = texNode.depth(instanceIndex.mod(int(count)));
    panel.opacityNode = float(0.8);

    return [edge, edge, top, edge, panel, panel];
  }, []);

  return doorCount ? (
    <instancedMesh
      name="doors"
      ref={state.ref("inst")}
      args={[box, undefined, doorCount]}
      material={materials}
      renderOrder={6}
    />
  ) : null;
}

const texW = 256;
const texH = 512;

function createPanelAtlas() {
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

type State = {
  inst: null | THREE.InstancedMesh;
  positionInstances: () => void;
};

const doorHeight = 2;
const panelDepth = 0.08;
const hullPanelDepth = 0.2;
const tmpMat = new Mat();
const tmpV1 = new Vect();
const tmpV2 = new Vect();
const tmpMat4 = new THREE.Matrix4();
