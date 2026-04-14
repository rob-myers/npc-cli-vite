import { geomService, Mat, Poly, useStateRef, Vect } from "@npc-cli/util";
import { pause } from "@npc-cli/util/legacy/generic";
import { drawPolygons } from "@npc-cli/util/service/canvas";
import { useContext, useEffect, useMemo } from "react";
import { generateUUID } from "three/src/math/MathUtils.js";
import { texture } from "three/src/nodes/accessors/TextureNode.js";
import { uv } from "three/src/nodes/accessors/UV.js";
import { attribute } from "three/src/nodes/core/AttributeNode.js";
import { instanceIndex } from "three/src/nodes/core/IndexNode.js";
import { int } from "three/src/nodes/tsl/TSLCore.js";
import * as THREE from "three/webgpu";
import { geomorphGridMeters, gmFloorExtraScale, MAX_GEOMORPH_INSTANCES, worldToSguScale } from "../const";
import { createXzQuad, embedXZMat4 } from "../service/geometry";
import { isEdgeGm } from "../service/geomorph";
import { getGridPattern } from "../service/grid-pattern";
import { PICK_TYPE, withPickOutput } from "../service/pick";
import { WorldContext } from "./world-context";

export default function Floor() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      inst: null,
      quad: createXzQuad(),
      gridPattern: getGridPattern(geomorphGridMeters * worldToCanvas, "rgba(100, 100, 100, 0.8)"),

      uvOffsets: new Float32Array(MAX_GEOMORPH_INSTANCES * 2),
      uvDimensions: new Float32Array(MAX_GEOMORPH_INSTANCES * 2),

      addUvs() {
        const uvOffsets = state.quad.getAttribute("uvOffsets");
        (uvOffsets.array as Float32Array).fill(0); // repeated (0, 0)
        const uvDimensions = state.quad.getAttribute("uvDimensions");
        (uvDimensions.array as Float32Array).fill(0);

        for (const [gmId, gm] of w.gms.entries()) {
          // geomorph 301 pngRect height/width ~ 0.5 but not equal
          (uvDimensions.array as Float32Array)[gmId * 2 + 0] = 1;
          (uvDimensions.array as Float32Array)[gmId * 2 + 1] = isEdgeGm(gm.key)
            ? gm.bounds.height / gm.bounds.width
            : 1;
        }

        uvOffsets.needsUpdate = true;
        uvDimensions.needsUpdate = true;
      },

      async draw() {
        // one texture per gmId = texId (nav tris can change near hull doors)
        for (const [gmId] of w.gms.entries()) {
          state.drawGm(gmId);
          w.texFloor.updateIndex(gmId);
          await pause();
        }
      },

      drawGm(gmId) {
        const { ct } = w.texFloor;
        // get untransformed layout i.e. not an instance
        const gmKey = w.gms[gmId]?.key;
        const layout = w.assets.layout[gmKey];
        if (!layout) return;

        ct.resetTransform();
        ct.globalCompositeOperation = "source-over";
        ct.clearRect(0, 0, ct.canvas.width, ct.canvas.height);
        // biome-ignore format: succinct
        ct.setTransform( worldToCanvas, 0, 0, worldToCanvas, -layout.bounds.x * worldToCanvas, -layout.bounds.y * worldToCanvas);

        // try inset by half hull doorway to avoid adjacent doorway overlap
        const hullFloor = geomService.createInset(layout.hullPoly.map((x) => x.clone().removeHoles())[0], 0.08);
        drawPolygons(ct, hullFloor, { fillStyle: "#fff", strokeStyle: null });

        // grid
        // 🚧 must offset by geomorph position (currently slightly off)
        // ct.save();
        // drawPolygons(ct, hullFloor, { clip: true, fillStyle: "#f00", strokeStyle: null });
        // ct.setTransform(1, 0, 0, 1, -layout.bounds.x * worldToCanvas, -layout.bounds.y * worldToCanvas);
        // ct.fillStyle = state.gridPattern;
        // ct.fillRect(0, 0, ct.canvas.width, ct.canvas.height);
        // // biome-ignore format: succinct
        // ct.setTransform(worldToCanvas, 0, 0, worldToCanvas, -layout.bounds.x * worldToCanvas, -layout.bounds.y * worldToCanvas);
        // ct.restore();

        // wall bases
        drawPolygons(ct, layout.walls, { fillStyle: "#000", strokeStyle: "#333", lineWidth: 0.025 });

        // draw nav mesh (gmId specific)
        ct.lineJoin = "round";
        ct.lineWidth = 0.01;
        const fillStyle = "#4442";
        const strokeStyle = "#4444";
        const triangle = new Poly([new Vect(), new Vect(), new Vect()]);
        (w.nav?.toNavTris[gmId] ?? []).forEach(([positions]) => {
          for (let i = 0; i < positions.length; i += 9) {
            triangle.outline[0].set(positions[i], positions[i + 2]);
            triangle.outline[1].set(positions[i + 3], positions[i + 5]);
            triangle.outline[2].set(positions[i + 6], positions[i + 8]);
            drawPolygons(ct, [triangle], { fillStyle, strokeStyle });
          }
        });

        // // hull doorways
        // drawPolygons(
        //   ct,
        //   layout.hullDoors.flatMap(({ poly }) => geomService.createInset(poly, 0.025)),
        //   { fillStyle: "#000", strokeStyle: "#000", lineWidth: 0 },
        // );

        // obstacle drop shadows
        const shadowPolys = Poly.union(
          layout.obstacles.flatMap((x) =>
            x.origPoly.meta["no-shadow"] ? [] : x.origPoly.clone().applyMatrix(tmpMat1.setMatrixValue(x.transform)),
          ),
        );
        drawPolygons(ct, shadowPolys, { fillStyle: "#0004", strokeStyle: null });

        // room outlines
        drawRoomOutlines(ct, layout);

        // // uniform directional wall shadows
        // ct.save();
        // drawPolygons(ct, hullFloor, { fillStyle: "#f00", strokeStyle: null, clip: true });
        // const shadowQuads = layout.walls.flatMap((w) =>
        //   w.outline.map((p1, i) => {
        //     const p2 = w.outline[(i + 1) % w.outline.length];
        //     return new Poly([
        //       new Vect(p1.x, p1.y),
        //       new Vect(p2.x, p2.y),
        //       new Vect(p2.x + shadowDx, p2.y + shadowDy),
        //       new Vect(p1.x + shadowDx, p1.y + shadowDy),
        //     ]);
        //   }),
        // );
        // drawPolygons(ct, Poly.union(shadowQuads), { fillStyle: "rgba(0, 0, 0, 1)", strokeStyle: null });
        // ct.restore();
      },

      transformInstances() {
        if (!state.inst) return;
        for (const [gmId, gm] of w.gms.entries()) {
          const mat = new Mat({
            a: gm.bounds.width,
            b: 0,
            c: 0,
            d: gm.bounds.height,
            e: gm.bounds.x,
            f: gm.bounds.y,
          }).postMultiply(gm.matrix);
          state.inst.setMatrixAt(gmId, embedXZMat4(mat));
          // state.inst.setMatrixAt(gmId, embedXZMat4(mat, { yHeight: gmId * 1 }));
        }
        state.inst.instanceMatrix.needsUpdate = true;
        state.inst.computeBoundingSphere();
      },
    }),
    { reset: { gridPattern: true } },
  );

  w.floor = state;

  const shaderMeta = useMemo(() => {
    const texArray = w.texFloor;
    const uvDims = attribute("uvDimensions", "vec2");
    const uvOffs = attribute("uvOffsets", "vec2");
    const transformedUv = uv().mul(uvDims).add(uvOffs);
    const texNode = texture(texArray.tex, transformedUv);
    texNode.depthNode = instanceIndex.mod(int(texArray.opts.numTextures));
    return { texNode: texNode.depth(instanceIndex), pickNode: withPickOutput(PICK_TYPE.floor), uid: generateUUID() };
  }, [w.texFloor.hash]);

  useEffect(() => {
    state.transformInstances();
    state.addUvs();
    state.draw().then(() => w.update());
  }, [w.hash, w.nav, w.gmsData]);

  return (
    <instancedMesh
      name="floor"
      ref={state.ref("inst")}
      args={[undefined, undefined, MAX_GEOMORPH_INSTANCES]}
      renderOrder={-3}
    >
      <bufferGeometry attributes={state.quad.attributes} index={state.quad.index}>
        <instancedBufferAttribute attach="attributes-uvOffsets" args={[state.uvOffsets, 2]} />
        <instancedBufferAttribute attach="attributes-uvDimensions" args={[state.uvDimensions, 2]} />
      </bufferGeometry>

      <meshStandardNodeMaterial
        key={shaderMeta.uid}
        side={THREE.DoubleSide}
        transparent
        alphaTest={0.8}
        colorNode={shaderMeta.texNode}
        outputNode={shaderMeta.pickNode}
        depthWrite={false}
      />
    </instancedMesh>
  );
}

export type State = {
  inst: null | THREE.InstancedMesh;
  quad: THREE.BufferGeometry;
  gridPattern: CanvasPattern;
  uvOffsets: Float32Array;
  uvDimensions: Float32Array;
  addUvs(): void;
  draw(): Promise<void>;
  drawGm(gmId: number): void;
  transformInstances(): void;
};

function drawRoomOutlines(ct: CanvasRenderingContext2D, layout: Geomorph.Layout) {
  ct.save();
  ct.lineJoin = "round";
  ct.lineCap = "round";
  ct.lineWidth = 0.04;
  ct.strokeStyle = "rgba(100, 100, 100, 1)";
  const insetAmount = 0.4;
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
    const pts = poly.outline;
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
  ctx.fillStyle = "rgba(40, 42, 48, 0.05)";
  ctx.fillRect(0, 0, s, s);

  // tile grid lines
  ctx.strokeStyle = "rgba(80, 85, 95, 0.5)";
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, size, size);
  ctx.strokeRect(size, 0, size, size);
  ctx.strokeRect(0, size, size, size);
  ctx.strokeRect(size, size, size, size);

  // inner tile bevels (inset lines)
  const m = 4;
  ctx.strokeStyle = "rgba(100, 110, 120, 0.2)";
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
  ctx.fillStyle = "rgba(130, 140, 150, 1)";
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

const worldToCanvas = worldToSguScale * gmFloorExtraScale;
const shadowDx = Math.cos(Math.PI / 4) * 0.25;
const shadowDy = Math.sin(Math.PI / 4) * 0.25;
const tmpMat1 = new Mat();
