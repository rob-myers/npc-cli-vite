import { Mat, useStateRef } from "@npc-cli/util";
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
import { gmFloorExtraScale, MAX_GEOMORPH_INSTANCES, sguToWorldScale, wallHeight, worldToSguScale } from "../const";
import { createXzQuad, embedXZMat4 } from "../service/geometry";
import { isEdgeGm } from "../service/geomorph";
import { WorldContext } from "./world-context";

export default function Ceiling() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      inst: null as null | THREE.InstancedMesh,
      quad: createXzQuad(),

      uvOffsets: new Float32Array(MAX_GEOMORPH_INSTANCES * 2),
      uvDimensions: new Float32Array(MAX_GEOMORPH_INSTANCES * 2),

      addUvs() {
        const uvOffsets = state.quad.getAttribute("uvOffsets");
        (uvOffsets.array as Float32Array).fill(0); // repeated (0, 0)
        const uvDimensions = state.quad.getAttribute("uvDimensions");
        (uvDimensions.array as Float32Array).fill(0);

        for (const [gmId, gm] of w.gms.entries()) {
          (uvDimensions.array as Float32Array)[gmId * 2 + 0] = 1;
          (uvDimensions.array as Float32Array)[gmId * 2 + 1] = isEdgeGm(gm.key)
            ? gm.bounds.height / gm.bounds.width
            : 1;
        }

        uvOffsets.needsUpdate = true;
        uvDimensions.needsUpdate = true;
      },

      async draw() {
        // texture per gmId like floor
        for (const [gmId] of w.seenGmKeys.entries()) {
          state.drawGm(gmId);
          w.texCeil.updateIndex(gmId);
          await pause();
        }
      },

      drawGm(gmId) {
        const { ct } = w.texCeil;
        const gmKey = w.gms[gmId]?.key;
        const layout = w.assets.layout[gmKey];
        if (!layout) return;
        const { bounds } = layout;

        ct.resetTransform();
        ct.clearRect(0, 0, ct.canvas.width, ct.canvas.height);
        ct.setTransform(worldToCanvas, 0, 0, worldToCanvas, -bounds.x * worldToCanvas, -bounds.y * worldToCanvas);

        const { tops, polyDecals } = w.gmsData.byKey[gmKey];

        // wall/door tops
        drawPolygons(ct, tops.nonHull, { fillStyle: "#999", strokeStyle: "#001", lineWidth: thickLineWidth });
        drawPolygons(ct, tops.window, { fillStyle: "#000", strokeStyle: wallsHighlight, lineWidth: thickLineWidth });
        drawPolygons(ct, tops.broad, { fillStyle: "#000", strokeStyle: grey90, lineWidth: thinLineWidth });
        drawPolygons(ct, tops.hull, { fillStyle: "#000", strokeStyle: wallsHighlight, lineWidth: thickLineWidth }); // hull walls and doors

        // decals
        polyDecals
          .filter((x) => x.meta.ceil === true)
          .forEach((x) => {
            const strokeWidth = typeof x.meta.strokeWidth === "number" ? x.meta.strokeWidth * sguToWorldScale : 0.08;
            drawPolygons(ct, x, {
              fillStyle: x.meta.fill || "red",
              strokeStyle: x.meta.stroke || null,
              lineWidth: strokeWidth,
            });
          });

        // Stroke a square at each corner to avoid z-fighting
        ct.strokeStyle = wallsColor;
        const hullRect = layout.hullPoly[0].rect;
        const cornerDim = 8 * sguToWorldScale;
        ct.lineWidth = 0.02;
        ct.strokeRect(hullRect.x, hullRect.y, cornerDim, cornerDim);
        ct.strokeRect(hullRect.right - cornerDim, hullRect.y, cornerDim, cornerDim);
        ct.strokeRect(hullRect.x, hullRect.bottom - cornerDim, cornerDim, cornerDim);
        ct.strokeRect(hullRect.right - cornerDim, hullRect.bottom - cornerDim, cornerDim, cornerDim);
      },

      transformInstances() {
        if (!state.inst) return;
        for (const [gmId, gm] of w.gms.entries()) {
          const mat = new Mat({
            a: gm.bounds.width, b: 0,
            c: 0, d: gm.bounds.height,
            e: gm.bounds.x, f: gm.bounds.y,
          }).postMultiply(gm.matrix);
          state.inst.setMatrixAt(gmId, embedXZMat4(mat));
        }
        state.inst.instanceMatrix.needsUpdate = true;
        state.inst.computeBoundingSphere();
      },
    }),
  );

  w.ceil = state;

  const shaderMeta = useMemo(() => {
    const texArray = w.texCeil;
    const uvDims = attribute("uvDimensions", "vec2");
    const uvOffs = attribute("uvOffsets", "vec2");
    const transformedUv = uv().mul(uvDims).add(uvOffs);
    const texNode = texture(texArray.tex, transformedUv);
    texNode.depthNode = instanceIndex.mod(int(texArray.opts.numTextures));
    return { texNode: texNode.depth(instanceIndex), uid: generateUUID() };
  }, []);

  useEffect(() => {
    state.transformInstances();
    state.addUvs();
    state.draw().then(() => w.update());
  }, [w.hash, w.nav, w.gmsData]);

  return (
    <instancedMesh
      name="ceiling"
      ref={state.ref("inst")}
      args={[undefined, undefined, MAX_GEOMORPH_INSTANCES]}
      position={[0, wallHeight, 0]}
      renderOrder={6}
    >
      <bufferGeometry attributes={state.quad.attributes} index={state.quad.index}>
        <instancedBufferAttribute attach="attributes-uvOffsets" args={[state.uvOffsets, 2]} />
        <instancedBufferAttribute attach="attributes-uvDimensions" args={[state.uvDimensions, 2]} />
      </bufferGeometry>

      <meshStandardNodeMaterial
        side={THREE.DoubleSide}
        transparent
        key={shaderMeta.uid}
        colorNode={shaderMeta.texNode}
        depthWrite={false}
      />
    </instancedMesh>
  );
}

export type State = {
  inst: null | THREE.InstancedMesh;
  quad: THREE.BufferGeometry;
  uvOffsets: Float32Array;
  uvDimensions: Float32Array;
  addUvs(): void;
  draw(): Promise<void>;
  drawGm(gmId: number): void;
  transformInstances(): void;
};

const worldToCanvas = worldToSguScale * gmFloorExtraScale;
const wallsColor = "#333";
const wallsHighlight = "#999";
const grey90 = "rgb(90, 90, 90)";
const thinLineWidth = 0.04;
const thickLineWidth = 0.06;
