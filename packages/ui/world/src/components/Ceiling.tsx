import { useStateRef } from "@npc-cli/util";
import { Mat } from "@npc-cli/util/geom";
import { pause } from "@npc-cli/util/legacy/generic";
import { drawPolygons } from "@npc-cli/util/service/canvas";
import { useContext, useEffect, useMemo } from "react";
import { generateUUID } from "three/src/math/MathUtils.js";
import { attribute, instanceIndex, int, texture, transformNormalToView, uv, vec3 } from "three/tsl";
import * as THREE from "three/webgpu";
import { gmFloorExtraScale, MAX_GEOMORPH_INSTANCES, sguToWorldScale, wallHeight, worldToSguScale } from "../const";
import { createTwoSidedXzQuad, embedXZMat4 } from "../service/geometry";
import { isEdgeGm } from "../service/geomorph";
import { OBJECT_PICK_KEY_TO_RED } from "../service/pick";
import { WorldContext } from "./world-context";

export default function Ceiling() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      inst: null,
      quad: createTwoSidedXzQuad(),
      uvOffsets: new Float32Array(MAX_GEOMORPH_INSTANCES * 2),
      uvDimensions: new Float32Array(MAX_GEOMORPH_INSTANCES * 2),
      uvTextureIds: new Uint32Array(MAX_GEOMORPH_INSTANCES * 1),

      addUvs() {
        const uvOffsets = state.quad.getAttribute("uvOffsets");
        (uvOffsets.array as Float32Array).fill(0); // repeated (0, 0)
        const uvDimensions = state.quad.getAttribute("uvDimensions");
        (uvDimensions.array as Float32Array).fill(0);
        const uvTextureIds = state.quad.getAttribute("uvTextureIds");
        (uvTextureIds.array as Uint32Array).fill(0);

        for (const [gmId, gm] of w.gms.entries()) {
          (uvDimensions.array as Float32Array)[gmId * 2 + 0] = 1;
          (uvDimensions.array as Float32Array)[gmId * 2 + 1] = isEdgeGm(gm.key)
            ? gm.bounds.height / gm.bounds.width
            : 1;
          (uvTextureIds.array as Uint32Array)[gmId] = w.getGmKeyTexId(gm.key);
        }

        uvOffsets.needsUpdate = true;
        uvDimensions.needsUpdate = true;
        uvTextureIds.needsUpdate = true;
      },
      async draw() {
        // texture per gmKey (unlike floor)
        for (const gmKey of w.seenGmKeys) {
          state.drawGm(gmKey);
          w.texCeil.updateIndex(w.getGmKeyTexId(gmKey));
          await pause();
        }
      },
      drawGm(gmKey) {
        const layout = w.assets.layout[gmKey];
        if (!layout) return;

        const { ct } = w.texCeil;
        ct.resetTransform();
        ct.clearRect(0, 0, ct.canvas.width, ct.canvas.height);
        // biome-ignore format: preserve whitespace
        ct.setTransform(worldToCanvas, 0, 0, worldToCanvas, -layout.bounds.x * worldToCanvas, -layout.bounds.y * worldToCanvas);

        const { tops, polyDecals } = w.gmsData.byKey[gmKey];

        // door/wall tops
        const { ceiling: tc } = w.getTheme();
        drawPolygons(ct, tops.nonHullDoor, {
          fillStyle: tc.nonHull.fill,
          strokeStyle: tc.nonHull.stroke,
          lineWidth: thinLineWidth,
        });
        drawPolygons(ct, tops.hullDoor, {
          fillStyle: tc.hull.fill,
          strokeStyle: tc.hull.stroke,
          lineWidth: thickLineWidth,
        });
        drawPolygons(ct, tops.nonHullWall, {
          fillStyle: tc.nonHull.fill,
          strokeStyle: tc.nonHull.stroke,
          lineWidth: thinLineWidth,
        });
        drawPolygons(ct, tops.hullWall, {
          fillStyle: tc.hull.fill,
          strokeStyle: tc.hull.stroke,
          lineWidth: thickLineWidth,
        });
        drawPolygons(ct, tops.window, {
          fillStyle: tc.hull.fill,
          strokeStyle: tc.hull.stroke,
          lineWidth: thickLineWidth,
        });
        drawPolygons(ct, tops.broad, {
          fillStyle: tc.hull.fill,
          strokeStyle: "rgba(90, 90, 90, 0.1)",
          lineWidth: thickerLineWidth,
        });

        for (const decal of polyDecals) {
          if (decal.meta.ceil !== true) continue;
          const strokeWidth =
            typeof decal.meta.strokeWidth === "number" ? decal.meta.strokeWidth * sguToWorldScale : 0.08;
          drawPolygons(ct, decal, {
            fillStyle: decal.meta.fill || "red",
            strokeStyle: decal.meta.stroke || null,
            lineWidth: strokeWidth,
          });
        }

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
          // biome-ignore format: succinct
          const mat = new Mat({ a: gm.bounds.width, b: 0, c: 0, d: gm.bounds.height, e: gm.bounds.x, f: gm.bounds.y }).postMultiply(gm.matrix);
          state.inst.setMatrixAt(gmId, embedXZMat4(mat));
        }
        state.inst.instanceMatrix.needsUpdate = true;
        state.inst.computeBoundingSphere();
      },
    }),
  );

  w.ceil = state;

  const material = useMemo(() => {
    const texArray = w.texCeil;
    const uvDims = attribute<"vec2">("uvDimensions", "vec2");
    const uvOffs = attribute<"vec2">("uvOffsets", "vec2");
    const uvTexIds = attribute<"float">("uvTextureIds", "float");
    const transformedUv = uv().mul(uvDims).add(uvOffs);
    const texNode = texture(texArray.tex, transformedUv);
    texNode.depthNode = instanceIndex.mod(int(texArray.opts.numTextures));

    const opacityNode = w.view.objectPick.notEqual(0).select(
      // objectPick 0.5 ignores ceiling for easier picking
      w.view.objectPick.notEqual(1).select(0, 1),
      1, // beauty render
    );

    return {
      // fix InstancedMesh non-uniform scaling
      normalNode: transformNormalToView(vec3(0, 1, 0)),
      opacityNode,
      pickNode: w.view.withPickOutput(OBJECT_PICK_KEY_TO_RED.ceiling),
      texNode: texNode.depth(uvTexIds),
      uid: generateUUID(),
    };
  }, [w.texCeil.hash]);

  useEffect(() => {
    state.transformInstances();
    state.addUvs();
    state.draw().then(() => w.update());
  }, [w.hash, w.nav, w.gmsData, w.themeKey]);

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
        <instancedBufferAttribute attach="attributes-uvTextureIds" args={[state.uvTextureIds, 1]} />
      </bufferGeometry>

      <meshStandardNodeMaterial
        key={material.uid}
        side={THREE.FrontSide} // one draw-call
        transparent
        colorNode={material.texNode}
        normalNode={material.normalNode}
        outputNode={material.pickNode}
        opacityNode={material.opacityNode}
        depthWrite // use depth buffer to fix editable lighting
        alphaTest={0.3}
      />
    </instancedMesh>
  );
}

export type State = {
  inst: null | THREE.InstancedMesh;
  quad: THREE.BufferGeometry;
  uvOffsets: Float32Array;
  uvDimensions: Float32Array;
  uvTextureIds: Uint32Array;
  addUvs(): void;
  draw(): Promise<void>;
  drawGm(gmKey: Geomorph.StarShipGeomorphKey): void;
  transformInstances(): void;
};

const worldToCanvas = worldToSguScale * gmFloorExtraScale;
const wallsColor = "#333";
const thinLineWidth = 0.04;
const thickLineWidth = 0.06;
const thickerLineWidth = 0.1;
