import { memo } from "react";
import * as THREE from "three/webgpu";
import { npcScale } from "../const.npc";
import type { Npc } from "./npc";

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

export const MemoNpcInstance: React.MemoExoticComponent<(props: { epochMs: number; npc: Npc }) => React.JSX.Element> =
  memo(NpcInstance);
