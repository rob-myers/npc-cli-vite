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
  moving = false;
  stuckAccum = 0;
  lastPos = { x: 0, z: 0 };
  spawns = 0;
  resolve?: () => void;

  w: UseStateRef<import("./World").State>;

  constructor(w: UseStateRef<import("./World").State>, init: NpcInit) {
    this.w = w;
    Object.assign(this, init);
  }

  startWalking() {
    const { walk, idle } = this.w.npc.clips;
    if (!walk) return;
    this.moving = true;
    this.stuckAccum = 0;
    this.lastPos = { x: this.position.x, z: this.position.z };
    const idleAction = idle ? this.mixer.clipAction(idle) : null;
    const walkAction = this.mixer.clipAction(walk);
    idleAction?.fadeOut(0.3);
    walkAction.reset().fadeIn(0.3).play();
  }

  startIdle() {
    const { walk, idle } = this.w.npc.clips;
    if (!idle) return;
    this.moving = false;
    const walkAction = walk ? this.mixer.clipAction(walk) : null;
    const idleAction = this.mixer.clipAction(idle);
    walkAction?.fadeOut(0.3);
    idleAction.reset().fadeIn(0.3).play();
  }

  updateStuck(delta: number): boolean {
    const dx = this.position.x - this.lastPos.x;
    const dz = this.position.z - this.lastPos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    // 🚧 delay stuck a bit
    if (dist < 0.0065) {
      this.stuckAccum += delta;
    } else {
      this.stuckAccum = 0;
    }
    this.lastPos = { x: this.position.x, z: this.position.z };
    return this.stuckAccum > 0.4;
  }

  syncAnimation(speed: number) {
    const { walk } = this.w.npc.clips;
    if (!walk || !this.moving) return;
    const walkAction = this.mixer.clipAction(walk);
    walkAction.timeScale = Math.max(0.6, speed);
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
