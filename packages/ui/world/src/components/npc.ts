import type { buildGraph } from "@react-three/fiber";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import * as THREE from "three/webgpu";
import type { State as NpcsState } from "./NPCs";

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
  gltf: GLTF;

  agentId: string | null = null;
  epoch = 0;
  spawns = 0;
  resolve?: () => void;

  constructor(npcsState: NpcsState, init: NpcInit) {
    this.gltf = npcsState.gltf as GLTF;
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

    const gltf = this.gltf;
    if (!gltf) return;
    const idleClip = gltf.animations.find((c) => c.name === "idle");
    if (idleClip) {
      this.mixer.clipAction(idleClip).play();
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
