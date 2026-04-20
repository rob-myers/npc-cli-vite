import { memo } from "react";
import * as THREE from "three/webgpu";
import { npcScale } from "../const";
import type { Npc } from "./npc";

function NpcInstance({ npc, shadowMaterial }: Props) {
  const nodes = npc.graph.nodes;
  const bones = Object.values(nodes).filter((n) => n instanceof THREE.Bone);

  return (
    <group
      ref={npc.groupRef}
      position={[0, 0.01, 0]}
    >
      <skinnedMesh
        geometry={npc.geometry}
        material={[npc.material, shadowMaterial, npc.labelMaterial]}
        skeleton={npc.skinnedMesh.skeleton}
        scale={npcScale}
        position={npc.position}
        renderOrder={0}
      >
        {bones.length > 0 && <primitive object={bones[0]} />}
      </skinnedMesh>
    </group>
  );
}

export const MemoNpcInstance = memo(NpcInstance);

type Props = {
  npc: Npc;
  shadowMaterial: THREE.MeshBasicNodeMaterial;
  epoch: number;
};
