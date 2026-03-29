import type { StarShipGeomorphKey } from "@npc-cli/media/starship-symbol";
import { Mat, useStateRef } from "@npc-cli/util";
import { entries, pause } from "@npc-cli/util/legacy/generic";
import { drawPolygons } from "@npc-cli/util/service/skia-canvas";
import { useContext, useEffect, useMemo } from "react";
import { generateUUID } from "three/src/math/MathUtils.js";
import { texture } from "three/src/nodes/accessors/TextureNode.js";
import { uv } from "three/src/nodes/accessors/UV.js";
import { attribute } from "three/src/nodes/core/AttributeNode.js";
import { instanceIndex } from "three/src/nodes/core/IndexNode.js";
import { int } from "three/src/nodes/tsl/TSLCore.js";
import * as THREE from "three/webgpu";
import { gmFloorExtraScale, sguToWorldScale, wallHeight, worldToSguScale } from "../const";
import { createXzQuad, embedXZMat4 } from "../service/geometry";
import { isEdgeGm } from "../service/geomorph";
import { WorldContext } from "./world-context";

export default function Ceiling() {
  const w = useContext(WorldContext);

  const state = useStateRef(() => ({
    inst: null as null | THREE.InstancedMesh,
    quad: createXzQuad(),

    addUvs() {
      if (!state.inst) return;

      const attr = {
        /** Texture subrect top-left */
        uvOffsets: { def: [] as number[], TypedArray: Float32Array, itemSize: 2 },
        /** Texture subrect dimensions */
        uvDimensions: { def: [] as number[], TypedArray: Float32Array, itemSize: 2 },
        /** Texture ID for spritesheets */
        uvTextureIds: { def: [] as number[], TypedArray: Uint32Array, itemSize: 1 },
      };

      for (const gm of w.gms) {
        attr.uvOffsets.def.push(0, 0);
        attr.uvDimensions.def.push(
          1,
          // geomorph 301 bounds height/width ~ 0.5 but not equal
          isEdgeGm(gm.key) ? gm.bounds.height / gm.bounds.width : 1,
        );
        attr.uvTextureIds.def.push(w.getGmKeyTexId(gm.key));
      }

      for (const [key, value] of entries(attr)) {
        const { def, TypedArray, itemSize } = value;
        state.inst.geometry.setAttribute(key, new THREE.InstancedBufferAttribute(new TypedArray(def), itemSize));
      }
    },

    async draw() {
      for (const [texId, gmKey] of w.seenGmKeys.entries()) {
        state.drawGm(gmKey);
        w.texCeil.updateIndex(texId);
        await pause();
      }
    },

    drawGm(gmKey: StarShipGeomorphKey) {
      const { ct } = w.texCeil;
      const layout = w.assets.layout[gmKey];
      if (!layout) return;
      const { bounds } = layout;

      ct.resetTransform();
      ct.clearRect(0, 0, ct.canvas.width, ct.canvas.height);

      const worldToCanvas = worldToSguScale * gmFloorExtraScale;
      ct.setTransform(worldToCanvas, 0, 0, worldToCanvas, -bounds.x * worldToCanvas, -bounds.y * worldToCanvas);

      const { tops, polyDecals } = w.gmsData.byKey[gmKey];

      // wall/door tops
      const _nonHullWallsFill = "#001";
      const _nonHullWallsStroke = "#888";
      const windowsFill = "#000";
      const broadFill = "#000";
      const grey90 = "rgb(90, 90, 90)";
      const wallsColor = "#333";
      const wallsHighlight = "#999";
      const thinLineWidth = 0.04;
      const thickLineWidth = 0.06;

      //   drawPolygons(ct, tops.nonHull, { fillStyle: nonHullWallsFill, strokeStyle: nonHullWallsStroke, lineWidth: thickLineWidth });
      drawPolygons(ct, tops.nonHull, { fillStyle: "#999", strokeStyle: "#001", lineWidth: thickLineWidth });

      drawPolygons(ct, tops.window, { fillStyle: windowsFill, strokeStyle: wallsHighlight, lineWidth: thickLineWidth });
      drawPolygons(ct, tops.broad, { fillStyle: broadFill, strokeStyle: grey90, lineWidth: thinLineWidth });

      // drawPolygons(ct, tops.hull, [black, wallsColor, thickLineWidth]); // hull walls and doors
      // drawPolygons(ct, tops.hull, [black, wallsHighlight, thickLineWidth]); // hull walls and doors
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
          // drawPolygons(ct, x, ['red', 'white', 0.08]);
        });

      ct.strokeStyle = wallsColor;

      // Stroke a square at each corner to avoid z-fighting
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
          a: gm.bounds.width,
          b: 0,
          c: 0,
          d: gm.bounds.height,
          e: gm.bounds.x,
          f: gm.bounds.y,
        }).postMultiply(gm.matrix);
        // if (mat.determinant < 0) mat.preMultiply([-1, 0, 0, 1, 1, 0])
        state.inst.setMatrixAt(gmId, embedXZMat4(mat));
      }
      state.inst.instanceMatrix.needsUpdate = true;
      state.inst.computeBoundingSphere();
    },
  }));

  // three shader language
  const shaderMeta = useMemo(() => {
    const texArray = w.texCeil;
    // aligned to instances
    const uvDims = attribute("uvDimensions", "vec2");
    const uvOffs = attribute("uvOffsets", "vec2");
    const transformedUv = uv().mul(uvDims).add(uvOffs);
    const texNode = texture(texArray.tex, transformedUv);
    texNode.depthNode = instanceIndex.mod(int(texArray.opts.numTextures));
    return { texNode, uid: generateUUID() };
  }, []);

  useEffect(() => {
    state.transformInstances();
    state.addUvs();
    state.draw().then(() => w.update());
  }, [w.hash, w.nav, w.gmsData]);

  return (
    <group>
      {w.gms.length > 0 && (
        <instancedMesh
          name="ceiling"
          ref={state.ref("inst")}
          args={[state.quad, undefined, w.gms.length]}
          position={[0, wallHeight, 0]}
          renderOrder={6}
        >
          <meshStandardNodeMaterial
            side={THREE.DoubleSide}
            transparent
            key={shaderMeta.uid}
            colorNode={shaderMeta.texNode}
            depthWrite={false}
          />
        </instancedMesh>
      )}
    </group>
  );
}
