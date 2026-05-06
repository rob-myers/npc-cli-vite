import type { UseStateRef } from "@npc-cli/util";
import type { buildGraph } from "@react-three/fiber";
import { createDefaultQueryFilter, type FindNearestPolyResult, getNodeByRef, type QueryFilter } from "navcat";
import { crowd as crowdApi } from "navcat/blocks";
import type { uniform } from "three/tsl";
import * as THREE from "three/webgpu";
import { npcScale } from "../const";
import { addBodyKeyUidRelation, npcToBodyKey } from "../service/physics-bijection";
import { decodeDoorAreaId, isDoorAreaId } from "../worker/nav-util";

const emptyAnimationMixer = new THREE.AnimationMixer({} as THREE.Object3D);

export class Npc {
  key: string;
  /** Expect ≤ 200 npcs but technically ≤ 65535 */
  pickId: number;
  /** Physics body */
  bodyUid: number;
  /** Skin selection */
  skinIndexUniform: ReturnType<typeof uniform<number>>;
  /** Labels are store in an ArrayTexture */
  labelLayerIndex: number;

  group: THREE.Group | null = null;
  material: THREE.MeshStandardNodeMaterial;
  shadowMaterial: THREE.MeshBasicNodeMaterial;
  labelMaterial: THREE.MeshBasicNodeMaterial;
  mixer: THREE.AnimationMixer = emptyAnimationMixer;
  skinnedMesh: THREE.SkinnedMesh;
  graph: ReturnType<typeof buildGraph>;
  geometry: THREE.BufferGeometry;

  /** Synced with crowd agent */
  position: THREE.Vector3;
  agentId: string | null = null;
  queryFilter: QueryFilter;

  lookAt: JshCli.GroundPoint | null = null;
  lastBlockingArea = -1;
  lastPinTime = 0;
  lastPos = { x: 0, y: 0 };
  lastTarget = { x: 0, y: 0 };
  moving = false;
  resolve?: () => void;
  spawns = 0;
  stuckAccum = 0;

  w: UseStateRef<import("./World").State>;

  get skinIndex() {
    return this.skinIndexUniform.value;
  }

  constructor(w: UseStateRef<import("./World").State>, init: NpcInit) {
    this.w = w;
    Object.assign(this, init);

    this.key = init.key;
    this.pickId = init.pickId;
    this.skinIndexUniform = init.skinIndexUniform;
    this.labelLayerIndex = init.labelLayerIndex;
    this.position = init.position;
    this.material = init.material;
    this.labelMaterial = init.labelMaterial;
    this.shadowMaterial = init.shadowMaterial;
    this.skinnedMesh = init.skinnedMesh;
    this.graph = init.graph;
    this.geometry = init.geometry;

    // use case for lastBlockingArea?
    this.queryFilter = {
      ...createDefaultQueryFilter(),
      passFilter: (nodeRef, navMesh) => {
        const node = getNodeByRef(navMesh, nodeRef);

        if (isDoorAreaId(node.area) === true) {
          const decoded = decodeDoorAreaId(node.area);
          const open = w.door.isOpen(decoded.gmId, decoded.doorId);
          if (!open) {
            this.lastBlockingArea = node.area;
          }
          return open;
        }

        return true;
      },
    };

    this.bodyUid = addBodyKeyUidRelation(npcToBodyKey(this.key), w.npc.physics);
  }

  changeSkin(keyOrIndex: string | number) {
    const index = typeof keyOrIndex === "number" ? keyOrIndex : this.w.npc.getSkinIndex(keyOrIndex);
    if (index === -1) throw Error(`Skin "${keyOrIndex}" not found`);
    this.skinIndexUniform.value = index;
  }

  pinTo(result: FindNearestPolyResult) {
    if (this.agentId === null || result.success === false) {
      return false;
    }
    this.lastPinTime = this.w.timer.getElapsedTime();
    return crowdApi.requestMoveTarget(this.w.npc.crowd, this.agentId, result.nodeRef, result.position);
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
    this.lookAt = null;
    this.lastBlockingArea = -1;
    this.stuckAccum = 0;
    this.lastPos = { x: this.position.x, y: this.position.z };
    if (this.moving) return;
    this.moving = true;
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
    walkAction.timeScale = Math.max(1.25 * (0.55 / npcScale), speed);
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
  skinIndexUniform: THREE.UniformNode<number>;
  labelLayerIndex: number;
  position: THREE.Vector3;
  material: THREE.MeshStandardNodeMaterial;
  shadowMaterial: THREE.MeshBasicNodeMaterial;
  labelMaterial: THREE.MeshBasicNodeMaterial;
  skinnedMesh: THREE.SkinnedMesh;
  graph: ReturnType<typeof buildGraph>;
  geometry: THREE.BufferGeometry;
};
