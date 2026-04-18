import { useStateRef } from "@npc-cli/util";
import { memo } from "react";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three/webgpu";
import { npcScale } from "../const";
import type { Npc } from "./NPCs";

function NpcInstance({ npc, shadowMaterial, gltf }: Props) {
  const state = useStateRef(
    (): State => ({
      groupRef(group) {
        npc.group = group;
        if (group) {
          npc.mixer = new THREE.AnimationMixer(group);
          const clips = gltf.animations;
          const idleClip = clips.find((c) => c.name === "idle");
          const walkClip = clips.find((c) => c.name === "walk");
          if (!idleClip || !walkClip) return;

          const idle = npc.mixer.clipAction(idleClip);
          idle.play();
          npc.mixer.update(0);
        } else {
          npc.mixer.stopAllAction();
        }
      },
    }),
  );

  const nodes = npc.graph.nodes;
  const root = nodes.root as THREE.SkinnedMesh;
  const bones = Object.values(nodes).filter((n) => n instanceof THREE.Bone);

  return (
    <group
      ref={state.groupRef}
      position={[0, 0.01, 0]} // for shadow
    >
      <skinnedMesh
        geometry={npc.geometry}
        material={[npc.material, shadowMaterial, npc.labelMaterial]}
        skeleton={root.skeleton}
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
  gltf: GLTF;
  epoch: number;
};

type State = {
  groupRef(group: null | THREE.Group): void;
};
