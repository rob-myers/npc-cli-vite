import { Mat, useStateRef } from "@npc-cli/util";
import { useContext, useEffect } from "react";
import * as THREE from "three/webgpu";
import { createXzQuad, embedXZMat4 } from "../service/geometry";
import { WorldContext } from "./world-context";

export default function Floor() {
  const w = useContext(WorldContext);

  const state = useStateRef(() => ({
    inst: null as null | THREE.InstancedMesh,
    quad: createXzQuad(),
    // material: createDemoTexArrayMaterial(w.texFloor),
    // material: createTestOutlineTexArrayMaterial(w.texFloor),
    material: new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide, wireframe: true }),

    transformInstances() {
      if (!state.inst) return;
      for (const [gmId, gm] of w.gms.entries()) {
        const mat = new Mat([gm.bounds.width, 0, 0, gm.bounds.height, gm.bounds.x, gm.bounds.y]).postMultiply(
          gm.matrix,
        );
        // if (mat.determinant < 0) mat.preMultiply([-1, 0, 0, 1, 1, 0])
        state.inst.setMatrixAt(gmId, embedXZMat4(mat));
      }
      state.inst.instanceMatrix.needsUpdate = true;
      state.inst.computeBoundingSphere();
    },
  }));

  useEffect(() => {
    state.transformInstances();
    // state.addUvs();
    // state.draw().then(() => w.update());
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
