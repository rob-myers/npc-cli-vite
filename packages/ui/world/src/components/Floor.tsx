import { useComposedRefs, useStateRef } from "@npc-cli/util";
import * as THREE from "three/webgpu";
import { createXzQuad } from "../service/geometry";
import { demoInstancedQuad } from "./Demo";

export default function Floor() {
  const state = useStateRef(() => ({
    inst: null as null | THREE.InstancedMesh,
    quad: createXzQuad(),
  }));

  return (
    <group>
      <instancedMesh
        name="floor"
        ref={useComposedRefs(state.ref("inst"), demoInstancedQuad.ref)}
        args={[state.quad, undefined, demoInstancedQuad.metas.length]}
        renderOrder={-3}
      >
        <meshBasicMaterial side={THREE.DoubleSide} />
      </instancedMesh>
    </group>
  );
}
