import type { StarShipGeomorphKey } from "@npc-cli/media/starship-symbol";
import { Mat, Poly, useStateRef, Vect } from "@npc-cli/util";
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
import { geomorphGridMeters, gmFloorExtraScale, worldToSguScale } from "../const";
import { createXzQuad, embedXZMat4 } from "../service/geometry";
import * as geomorph from "../service/geomorph";
import { getGridPattern } from "../service/grid-pattern";
import { WorldContext } from "./world-context";

export default function Floor() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    () => ({
      inst: null as null | THREE.InstancedMesh,
      quad: createXzQuad(),
      gridPattern: getGridPattern(geomorphGridMeters * worldToCanvas, "rgba(50, 50, 50, 0.8)"),

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
            // geomorph 301 pngRect height/width ~ 0.5 but not equal
            geomorph.isEdgeGm(gm.key) ? gm.bounds.height / gm.bounds.width : 1,
          );
          attr.uvTextureIds.def.push(w.getGmKeyTexId(gm.key));
        }

        for (const [key, value] of entries(attr)) {
          const { def, TypedArray, itemSize } = value;
          state.inst.geometry.setAttribute(key, new THREE.InstancedBufferAttribute(new TypedArray(def), itemSize));
        }
      },

      async draw() {
        // each gmKey has exactly one texture
        for (const [texId, gmKey] of w.seenGmKeys.entries()) {
          state.drawGm(gmKey);
          w.texFloor.updateIndex(texId);
          await pause();
        }
      },

      drawGm(gmKey: StarShipGeomorphKey) {
        const { ct } = w.texFloor;
        const gm = w.assets.layout[gmKey];
        if (!gm) return;

        ct.resetTransform();
        ct.clearRect(0, 0, ct.canvas.width, ct.canvas.height);
        ct.setTransform(worldToCanvas, 0, 0, worldToCanvas, -gm.bounds.x * worldToCanvas, -gm.bounds.y * worldToCanvas);
        ct.save();

        const hullFloor = gm.hullPoly.map((x) => x.clone().removeHoles());
        drawPolygons(ct, hullFloor, { fillStyle: "#fff", strokeStyle: null });

        // grid
        drawPolygons(ct, hullFloor, { fillStyle: "#f00", strokeStyle: null, clip: true });
        ct.setTransform(1, 0, 0, 1, -gm.bounds.x * worldToCanvas, -gm.bounds.y * worldToCanvas);
        ct.fillStyle = state.gridPattern;
        ct.fillRect(0, 0, ct.canvas.width, ct.canvas.height);
        ct.setTransform(worldToCanvas, 0, 0, worldToCanvas, -gm.bounds.x * worldToCanvas, -gm.bounds.y * worldToCanvas);
        ct.restore();

        // drop shadows, avoiding doubling
        const shadowPolys = Poly.union(
          gm.obstacles.flatMap((x) =>
            x.origPoly.meta["no-shadow"] ? [] : x.origPoly.clone().applyMatrix(tmpMat1.setMatrixValue(x.transform)),
          ),
        );
        drawPolygons(ct, shadowPolys, { fillStyle: "#0005", strokeStyle: null });

        // wall shadows (uniform directional light)
        ct.save();
        drawPolygons(ct, hullFloor, { fillStyle: "#f00", strokeStyle: null, clip: true });
        const shadowQuads = gm.walls.flatMap((w) =>
          w.outline.map((p1, i) => {
            const p2 = w.outline[(i + 1) % w.outline.length];
            return new Poly([
              new Vect(p1.x, p1.y),
              new Vect(p2.x, p2.y),
              new Vect(p2.x + shadowDx, p2.y + shadowDy),
              new Vect(p1.x + shadowDx, p1.y + shadowDy),
            ]);
          }),
        );
        drawPolygons(ct, Poly.union(shadowQuads), { fillStyle: "rgba(0, 0, 100, 0.3)", strokeStyle: null });
        ct.restore();

        // wall bases
        drawPolygons(ct, gm.walls, { fillStyle: "#0008", strokeStyle: null });

        // 🚧 draw nav mesh
        // 🚧 hull doorways
        // 🚧 hull doorways
        // 🚧 decals from gm.decor
        // 🚧 debug decor rects
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
    }),
    { reset: { gridPattern: true } },
  );

  // three shader language
  const shaderMeta = useMemo(() => {
    const texArray = w.texFloor;
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
  }, [w.hash, w.gms.length]);

  return (
    <group>
      {w.gms.length > 0 && (
        <instancedMesh
          name="floor"
          ref={state.ref("inst")}
          args={[state.quad, undefined, w.gms.length]}
          renderOrder={-3}
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

const worldToCanvas = worldToSguScale * gmFloorExtraScale;
// also try `Math.PI / 4`
const shadowDx = Math.cos(Math.PI / 4) * 0.5;
const shadowDy = Math.sin(Math.PI / 4) * 0.5;
const tmpMat1 = new Mat();
