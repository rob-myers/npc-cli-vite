import type { UseStateRef } from "@npc-cli/util";
import type { buildGraph } from "@react-three/fiber";
import { crowd as crowdApi } from "navcat/blocks";
import * as THREE from "three/webgpu";
import { parseGroundPoint } from "../service/geometry";

const emptyAnimationMixer = new THREE.AnimationMixer({} as THREE.Object3D);

export class Npc {
  key!: string;
  pickId!: number;

  labelLayerIndex!: number;
  group: THREE.Group | null = null;
  material!: THREE.MeshStandardNodeMaterial;
  labelMaterial!: THREE.MeshBasicNodeMaterial;
  mixer: THREE.AnimationMixer = emptyAnimationMixer;
  skinnedMesh!: THREE.SkinnedMesh;
  graph!: ReturnType<typeof buildGraph>;
  geometry!: THREE.BufferGeometry;

  position!: THREE.Vector3;

  agentId: string | null = null;
  epoch = 0;
  lookAt: JshCli.GroundPoint | null = null;
  moving = false;
  stuckAccum = 0;
  lastPinTime = 0;
  lastPos = { x: 0, y: 0 };
  spawns = 0;
  resolve?: () => void;

  w: UseStateRef<import("./World").State>;

  constructor(w: UseStateRef<import("./World").State>, init: NpcInit) {
    this.w = w;
    Object.assign(this, init);
  }

  // 🚧 simplify: getClosestPoly elsewhere
  pinTo(at: JshCli.PointAnyFormat, lookAt?: JshCli.PointAnyFormat) {
    // if (this.agentId === null) return emptyFailedResult;
    this.lastPinTime = this.w.timer.getElapsedTime();
    this.lookAt = lookAt ? parseGroundPoint(lookAt) : null;
    const result = this.w.npc.getClosestPoly(at);
    if (result.success === true && this.agentId !== null) {
      crowdApi.requestMoveTarget(this.w.npc.crowd, this.agentId, result.nodeRef, result.position);
    }
    return result;
  }

  updateLookAt(delta: number) {
    if (this.lookAt === null) return;
    const dx = this.lookAt.x - this.position.x;
    const dz = this.lookAt.y - this.position.z;
    if (dx * dx + dz * dz > 0.001) {
      this.smoothRotateToward(dx, dz, delta);
    }
  }

  startWalking() {
    const { walk, idle } = this.w.npc.clips;
    if (!walk) return;
    this.moving = true;
    this.lookAt = null;
    this.stuckAccum = 0;
    this.lastPos = { x: this.position.x, y: this.position.z };
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
    // delay stuck a bit
    if (this.w.timer.getElapsedTime() - this.lastPinTime < 2.5) {
      return false;
    }

    const dx = this.position.x - this.lastPos.x;
    const dz = this.position.z - this.lastPos.y;
    const dist = Math.hypot(dx, dz);
    this.stuckAccum += dist < 0.0065 ? delta : 0;
    this.lastPos = { x: this.position.x, y: this.position.z };
    return this.stuckAccum > 0.4;
  }

  smoothRotateToward(vx: number, vz: number, delta: number) {
    const target = Math.atan2(vx, vz) + Math.PI;
    let diff = target - this.skinnedMesh.rotation.y;
    diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    this.skinnedMesh.rotation.y += diff * (1 - Math.exp(-5 * delta));
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
