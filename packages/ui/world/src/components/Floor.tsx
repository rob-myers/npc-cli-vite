import type { StarShipGeomorphKey } from "@npc-cli/media/starship-symbol";
import { Mat, useStateRef } from "@npc-cli/util";
import { pause } from "@npc-cli/util/legacy/generic";
import { drawPolygons } from "@npc-cli/util/service/skia-canvas";
import { useContext, useEffect } from "react";
import * as THREE from "three/webgpu";
import { gmFloorExtraScale, worldToSguScale } from "../const";
import { createXzQuad, embedXZMat4 } from "../service/geometry";
import * as geomorph from "../service/geomorph";
import { createTexArrayBasicMaterial } from "./demo";
import { WorldContext } from "./world-context";

export default function Floor() {
  const w = useContext(WorldContext);

  const state = useStateRef(() => ({
    inst: null as null | THREE.InstancedMesh,
    quad: createXzQuad(),

    // material: createDemoTexArrayMaterial(w.texFloor),
    // material: createTestOutlineTexArrayMaterial(w.texFloor),
    // material: new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, wireframe: true }),
    material: createTexArrayBasicMaterial(w.texFloor, true),

    addUvs() {
      if (!state.inst) return;
      const uvOffsets: number[] = [];
      const uvDimensions: number[] = [];
      const uvTextureIds: number[] = [];
      /** `[0, 1, ..., maxGmId]` */
      const instanceIds: number[] = [];

      // 🚧 somehow provide uvDimensions to shader so image scaled properly

      for (const [gmId, gm] of w.gms.entries()) {
        uvOffsets.push(0, 0);
        // 🔔 edge geomorph 301 pngRect height/width ~ 0.5 (not equal)
        uvDimensions.push(1, geomorph.isEdgeGm(gm.key) ? gm.bounds.height / gm.bounds.width : 1);
        // uvTextureIds.push(w.gmsData.getTextureId(gm.key)); // 🚧 for spritesheets
        instanceIds.push(gmId);
      }

      state.inst.geometry.setAttribute("uvOffsets", new THREE.InstancedBufferAttribute(new Float32Array(uvOffsets), 2));
      state.inst.geometry.setAttribute(
        "uvDimensions",
        new THREE.InstancedBufferAttribute(new Float32Array(uvDimensions), 2),
      );
      state.inst.geometry.setAttribute(
        "uvTextureIds",
        new THREE.InstancedBufferAttribute(new Uint32Array(uvTextureIds), 1),
      );
      state.inst.geometry.setAttribute(
        "instanceIds",
        new THREE.InstancedBufferAttribute(new Uint32Array(instanceIds), 1),
      );
    },

    async draw() {
      // w.menu.measure('floor.draw');
      // for (const [texId, gmKey] of w.gmsData.seenGmKeys.entries()) {
      //   state.drawGm(gmKey);
      //   w.texFloor.updateIndex(texId);
      //   await pause();
      // }
      // w.menu.measure('floor.draw');
      for (const [texId, gm] of w.gms.entries()) {
        state.drawGm(gm.key);
        w.texFloor.updateIndex(texId); // 🚧 texId needn't be aligned
        await pause();
      }
    },

    drawGm(gmKey: StarShipGeomorphKey) {
      const { ct } = w.texFloor;
      const gm = w.assets.layout[gmKey];
      if (!gm) return;

      ct.resetTransform();
      ct.clearRect(0, 0, ct.canvas.width, ct.canvas.height);

      // 🚧
      ct.strokeStyle = "#0ff";
      ct.lineWidth = 8;
      ct.strokeRect(0, 0, ct.canvas.width, ct.canvas.height);

      ct.setTransform(worldToCanvas, 0, 0, worldToCanvas, -gm.bounds.x * worldToCanvas, -gm.bounds.y * worldToCanvas);

      // hull floor
      // if (state.dark === true) {
      //   drawPolygons(ct, gm.hullPoly.map(x => x.clone().removeHoles()), ['#111', null]);
      // }
      drawPolygons(
        ct,
        gm.hullPoly.map((x) => x.clone().removeHoles()),
        { fillStyle: "#f00", strokeStyle: null },
      );

      // // grid
      // ct.setTransform(1, 0, 0, 1, -gm.pngRect.x * worldToCanvas, -gm.pngRect.y * worldToCanvas);
      // ct.fillStyle = state.grid;
      // ct.fillRect(0, 0, ct.canvas.width, ct.canvas.height);
      // ct.setTransform(worldToCanvas, 0, 0, worldToCanvas, -gm.pngRect.x * worldToCanvas, -gm.pngRect.y * worldToCanvas);

      // drop shadows, avoiding doubling
      // const shadowPolys = Poly.union(
      //   gm.obstacles.flatMap((x) =>
      //     x.origPoly.meta["no-shadow"] ? [] : x.origPoly.clone().applyMatrix(tmpMat1.setMatrixValue(x.transform)),
      //   ),
      // );
      // drawPolygons(ct, shadowPolys, { fillStyle: "#0009", strokeStyle: null });

      // // wall bases
      // drawPolygons(ct, gm.walls, { fillStyle: "#0008", strokeStyle: null });

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
  }));

  useEffect(() => {
    state.transformInstances();
    state.addUvs();
    state.draw().then(() => w.update());
  }, [w.gms.length]);

  return (
    <group>
      <instancedMesh
        name="floor"
        // ref={useComposedRefs(state.ref("inst"), demoInstancedQuad.ref)}
        // args={[state.quad, undefined, demoInstancedQuad.metas.length]}
        ref={state.ref("inst")}
        args={[state.quad, undefined, w.gms.length]}
        renderOrder={-3}
        material={state.material}
      />
    </group>
  );
}

const tmpMat1 = new Mat();
const worldToCanvas = worldToSguScale * gmFloorExtraScale;
