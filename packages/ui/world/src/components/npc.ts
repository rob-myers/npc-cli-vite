import type { UseStateRef } from "@npc-cli/util";
import type { buildGraph } from "@react-three/fiber";
import * as THREE from "three/webgpu";

const emptyAnimationMixer = new THREE.AnimationMixer({} as THREE.Object3D);

export class Npc {
  key!: string;
  pickId!: number;
  labelLayerIndex!: number;
  position!: THREE.Vector3;
  group: THREE.Group | null = null;
  material!: THREE.MeshStandardNodeMaterial;
  labelMaterial!: THREE.MeshBasicNodeMaterial;
  mixer: THREE.AnimationMixer = emptyAnimationMixer;
  skinnedMesh!: THREE.SkinnedMesh;
  graph!: ReturnType<typeof buildGraph>;
  geometry!: THREE.BufferGeometry;
  agentId: string | null = null;
  epoch = 0;
  spawns = 0;
  resolve?: () => void;

  w: UseStateRef<import("./World").State>;

  constructor(w: UseStateRef<import("./World").State>, init: NpcInit) {
    this.w = w;
    Object.assign(this, init);
  }

  groupRef = (group: THREE.Group | null): void => {
    if (!group) {
      this.mixer.stopAllAction();
      return;
    }
    this.group = group;
    this.skinnedMesh = group.children[0] as THREE.SkinnedMesh;
    this.position = this.skinnedMesh.position;
    this.mixer = new THREE.AnimationMixer(group);

    this.resolve?.();

    const { idle } = this.w.npc.clips;
    if (idle) {
      this.mixer.clipAction(idle).play();
      this.mixer.update(0);
    }
  };
}

export type NpcInit = {
  key: string;
  pickId: number;
  labelLayerIndex: number;
  position: THREE.Vector3;
  material: THREE.MeshStandardNodeMaterial;
  labelMaterial: THREE.MeshBasicNodeMaterial;
  skinnedMesh: THREE.SkinnedMesh;
  graph: ReturnType<typeof buildGraph>;
  geometry: THREE.BufferGeometry;
};
