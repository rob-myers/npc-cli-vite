import { memo } from "react";
import * as THREE from "three/webgpu";
import { npcDims } from "../const.both";
import { npcMaterialConfig, npcScale } from "../const.npc";
import type { Npc } from "./npc";
import { labelYShiftMax } from "./npc-animation";

function NpcInstance({ npc }: { npc: Npc }) {
  const nodes = npc.graph.nodes;
  const bones = Object.values(nodes).filter((n) => n instanceof THREE.Bone);

  return (
    // keyed on the skeleton: the mixer caches its bindings by ROOT UUID, so new bones under the
    // same group would be driven by the old ones. Remounting re-runs `groupRef`, which rebuilds it.
    // NOT `epochMs`, which a material reset bumps too — that would snap the clip back to its start
    <group key={bones[0]?.uuid} ref={npc.groupRef} position={[0, 0.01, 0]}>
      <skinnedMesh
        geometry={npc.geometry}
        material={npc.material}
        ref={boundAnyPose}
        position={npc.position}
        renderOrder={0}
        rotation={npc.rotation}
        skeleton={npc.skinnedMesh.skeleton}
        scale={npcScale}
      >
        {bones.length > 0 && <primitive object={bones[0]} />}
      </skinnedMesh>
    </group>
  );
}

/**
 * Bounds for any pose, and the label, which only the vertex shader lifts overhead — else a pick's 1px frustum culls
 * them. Not computed lazily off the first pose drawn: a sphere fitted standing would cull a lying npc's legs
 */
function boundAnyPose(mesh: THREE.SkinnedMesh | null) {
  if (mesh === null) return;
  mesh.computeBoundingSphere = function () {
    this.boundingSphere = poseSphere.clone().union(labelSphere);
  };
  mesh.computeBoundingSphere(); // once, and never refitted to a pose
}

/** Standing, sitting, or lying along `-z`, they stay within about their height of their origin */
const poseSphere = new THREE.Sphere(new THREE.Vector3(), (npcDims.height / npcScale) * 1.25);

const labelSphere = new THREE.Sphere(
  new THREE.Vector3(0, labelYShiftMax, 0),
  // world metres to local
  Math.hypot(npcMaterialConfig.labelHalfWidth, npcMaterialConfig.labelHalfHeight) / npcScale,
);

export const MemoNpcInstance: React.MemoExoticComponent<(props: { epochMs: number; npc: Npc }) => React.JSX.Element> =
  memo(NpcInstance);
