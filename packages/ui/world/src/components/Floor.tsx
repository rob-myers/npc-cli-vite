import { useStateRef } from "@npc-cli/util";
import * as THREE from "three/webgpu";
import { createXzQuad } from "../service/three-geometry";

// biome-ignore format: grid layout
const instances = [
  { pos: [-8, 0, -8],  color: 0xe74c3c },
  { pos: [0, 0, -8],   color: 0x3498db },
  { pos: [8, 0, -8],   color: 0x2ecc71 },
  { pos: [-8, 0, 0],   color: 0xf39c12 },
  { pos: [0, 0, 0],    color: 0x9b59b6 },
  { pos: [8, 0, 0],    color: 0x1abc9c },
  { pos: [-8, 0, 8],   color: 0xe67e22 },
  { pos: [0, 0, 8],    color: 0x2980b9 },
  { pos: [8, 0, 8],    color: 0xd35400 },
  { pos: [0, 0, -16],  color: 0x27ae60 },
] as const;

export default function Floor() {
  const state = useStateRef(() => ({
    inst: null as null | THREE.InstancedMesh,
    quad: createXzQuad(),

    demoInitInstances(inst: THREE.InstancedMesh) {
      state.inst = inst;
      const mat = new THREE.Matrix4();
      const col = new THREE.Color();
      const scl = new THREE.Vector3(6, 1, 6);
      instances.forEach(({ pos: [x, y, z], color }, i) => {
        mat.makeTranslation(x, y, z).scale(scl);
        inst.setMatrixAt(i, mat);
        inst.setColorAt(i, col.set(color));
      });
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    },
  }));

  return (
    <group>
      <instancedMesh
        name="floor"
        ref={(inst) => inst && state.demoInitInstances(inst)}
        args={[state.quad, undefined, instances.length]}
        renderOrder={-3}
      >
        <meshBasicMaterial side={THREE.DoubleSide} />
      </instancedMesh>
    </group>
  );
}
