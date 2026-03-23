import type { StarShipGeomorphKey } from "@npc-cli/media/starship-symbol";
import { Mat, useStateRef } from "@npc-cli/util";
import { pause } from "@npc-cli/util/legacy/generic";
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

      gridPattern: getGridPattern(geomorphGridMeters * worldToCanvas, "rgba(200, 200, 200, 0.3)"),

      addUvs() {
        if (!state.inst) return;

        // specify texture rectangle (per instance)
        const uvOffsets: number[] = [];
        const uvDimensions: number[] = [];
        // textureId for spritesheets (later)
        const uvTextureIds: number[] = [];

        for (const gm of w.gms) {
          uvOffsets.push(0, 0);
          // edge geomorph 301 pngRect height/width ~ 0.5 but not equal
          uvDimensions.push(1, geomorph.isEdgeGm(gm.key) ? gm.bounds.height / gm.bounds.width : 1);
          uvTextureIds.push(w.getGmKeyTexId(gm.key));
        }

        state.inst.geometry.setAttribute(
          "uvOffsets",
          new THREE.InstancedBufferAttribute(new Float32Array(uvOffsets), 2),
        );
        state.inst.geometry.setAttribute(
          "uvDimensions",
          new THREE.InstancedBufferAttribute(new Float32Array(uvDimensions), 2),
        );
        state.inst.geometry.setAttribute(
          "uvTextureIds",
          new THREE.InstancedBufferAttribute(new Uint32Array(uvTextureIds), 1),
        );
      },

      async draw() {
        // aligned to textures e.g. no geomorph dups
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
        drawPolygons(ct, hullFloor, { fillStyle: "#123", strokeStyle: null });

        // grid
        drawPolygons(ct, hullFloor, { fillStyle: "#f00", strokeStyle: null, clip: true });
        ct.setTransform(1, 0, 0, 1, -gm.bounds.x * worldToCanvas, -gm.bounds.y * worldToCanvas);
        ct.fillStyle = state.gridPattern;
        ct.fillRect(0, 0, ct.canvas.width, ct.canvas.height);
        ct.setTransform(worldToCanvas, 0, 0, worldToCanvas, -gm.bounds.x * worldToCanvas, -gm.bounds.y * worldToCanvas);
        ct.restore();

        // 🚧 clean e.g. provide examples of each

        // // drop shadows, avoiding doubling
        // const shadowPolys = Poly.union(
        //   gm.obstacles.flatMap((x) =>
        //     x.origPoly.meta["no-shadow"] ? [] : x.origPoly.clone().applyMatrix(tmpMat1.setMatrixValue(x.transform)),
        //   ),
        // );
        // drawPolygons(ct, shadowPolys, { fillStyle: "#0009", strokeStyle: null });

        // wall bases
        drawPolygons(ct, gm.walls, { fillStyle: "#0008", strokeStyle: null });

        // // draw nav mesh
        // const triangle = new Poly([new Vect(), new Vect(), new Vect()]);
        // ct.lineJoin = "round";
        // ct.lineWidth = 0.06;
        // const fillStyle = "#444";
        // const strokeStyle = "#0007";
        // // (w.nav.toNavTris[gm.key] ?? []).forEach(([positions, indices]) => {
        // //   for (const index of indices) {
        // //     const triVId = index % 3; // 0, 1, 2
        // //     const vertId = indices[index];
        // //     triangle.outline[triVId].set(positions[3 * vertId], positions[3 * vertId + 2]);
        // //     if (triVId === 2) {
        // //       drawPolygons(ct, [triangle], [fillStyle, strokeStyle]);
        // //     }
        // //   }
        // // });

        // // hull doorways
        // // 🚧 geomorphs are slightly misaligned e.g. 301 vs 101 in small-map-1
        // // drawPolygons(ct, gm.hullDoors.flatMap(x => x.computeDoorway()), ['#000', null]);
        // drawPolygons(
        //   ct,
        //   gm.hullDoors.flatMap((x) => x.poly),
        //   { fillStyle: "#0004", strokeStyle: null },
        // );

        // // // decals from gm.decor
        // // const { decor } = w.geomorphs.sheet;
        // // const decals = gm.decor.filter(x => x.type === 'decal');
        // // for (const decal of decals) {
        // //   const rect = decor[decal.meta.img];
        // //   // drawPolygons(ct, [Poly.fromRect(decal.bounds2d)], ['#f00', null]);
        // //   ct.save();
        // //   ct.transform(...decal.transform);
        // //   if (state.dark === true) {// 🔔 grayscale decals for invert
        // //     ct.globalCompositeOperation = 'xor';
        // //   }
        // //   ct.drawImage(w.decorImgs[rect.sheetId], rect.x, rect.y, rect.width, rect.height, 0, 0, 1, 1);
        // //   ct.restore();
        // // }

        // // debug decor rects
        // // if (state.debug === true) {
        // //   drawPolygons(ct, gm.decor.filter(x => x.type === 'rect').map(x => Poly.fromRect(x.bounds2d)), [null, '#00f']);
        // // }
        // drawPolygons(
        //   ct,
        //   gm.decor.filter((x) => x.type === "rect").map((x) => Poly.fromRect(x.bounds2d)),
        //   { fillStyle: null, strokeStyle: "#00f" },
        // );
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
      <instancedMesh name="floor" ref={state.ref("inst")} args={[state.quad, undefined, w.gms.length]} renderOrder={-3}>
        <meshStandardNodeMaterial
          side={THREE.DoubleSide}
          transparent
          key={shaderMeta.uid}
          colorNode={shaderMeta.texNode}
          depthWrite={false}
        />
      </instancedMesh>
    </group>
  );
}

const worldToCanvas = worldToSguScale * gmFloorExtraScale;
