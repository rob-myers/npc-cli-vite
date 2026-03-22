import { useComposedRefs, useStateRef } from "@npc-cli/util";
import { useContext } from "react";
import type * as THREE from "three/webgpu";
import { createXzQuad } from "../service/geometry";
import { createDemoTexArrayMaterial, demoInstancedQuad } from "./demo";
import { WorldContext } from "./world-context";

export default function Floor() {
  const w = useContext(WorldContext);

  const state = useStateRef(() => ({
    inst: null as null | THREE.InstancedMesh,
    quad: createXzQuad(),
    material: createDemoTexArrayMaterial(w.texFloor),
  }));

  return (
    <group>
      <instancedMesh
        name="floor"
        ref={useComposedRefs(state.ref("inst"), demoInstancedQuad.ref)}
        args={[state.quad, undefined, demoInstancedQuad.metas.length]}
        renderOrder={-3}
        material={state.material}
      />
    </group>
  );
}
