import type { UseStateRef } from "@npc-cli/util";
import type { buildGraph } from "@react-three/fiber";
import { createDefaultQueryFilter, type FindNearestPolyResult, getNodeByRef, type QueryFilter } from "navcat";
import { crowd as crowdApi } from "navcat/blocks";
import type { uniform } from "three/tsl";
import * as THREE from "three/webgpu";
import {
  idleAgentMaxSpeed,
  idleMaxAcceleration,
  idleSeparatingMaxAcceleration,
  idleSeparationWeight,
  npcDefaultBubbleHeight,
  npcScale,
  walkAgentMaxSpeed,
  walkMaxAcceleration,
  walkSeparationWeight,
} from "../const";
import { groudPointToTuple, parseGroundPoint } from "../service/geometry";
import { addBodyKeyUidRelation, npcToBodyKey } from "../service/physics-bijection";
import { emptyAnimationClip } from "../service/three-animation";
import { decodeDoorAreaId, isDoorAreaId } from "../worker/nav-util";

const emptyAnimationMixer = new THREE.AnimationMixer({} as THREE.Object3D);

export class Npc {
  key: string;
  /** Expect ≤ 200 npcs but technically ≤ 65535 */
  pickId: number;
  /** Physics body */
  bodyUid: number;
  /** Skin selection */
  skinIndexUniform: ReturnType<typeof uniform<"float", number>>;
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

  agentId: string | null = null;
  bubbleOffset = new THREE.Vector3(0, npcDefaultBubbleHeight, 0);
  doorKeys = {} as { [key: `g${number}d${number}`]: boolean };
  last = {
    blockingArea: -1,
    /** Seconds elapsed */
    pinTime: 0,
    /** World time when NPC last became idle (seconds) */
    idleTime: 0,
    pos: { x: 0, y: 0 },
    dst: { x: 0, y: 0 },
    dstGrId: null as Geomorph.GmRoomId | null,
  };
  lookAt: JshCli.GroundPoint | null = null;
  /** Synced with crowd agent */
  position: THREE.Vector3;
  queryFilter: QueryFilter;
  moving = false;
  arrive = true;
  /** while idle and due to separationWeight */
  separating = false;
  moveClip = emptyAnimationClip;
  idleClip = emptyAnimationClip;
  spawns = 0;
  stuckAccum = 0;

  /** Used for spawn and move */
  resolve?: (key: string) => void;
  /** Used for spawn and move */
  reject?: (reason: Error) => void;

  w: UseStateRef<import("./World").State>;

  get agent() {
    return this.agentId === null ? null : (this.w.npc.crowd.agents[this.agentId] ?? null);
  }

  get clips() {
    return this.w.npc.clips;
  }

  get running() {
    return this.moveClip.name === "run";
  }

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
          if (!w.e.npcCanAccess(this.key, decoded.gdKey)) {
            this.last.blockingArea = node.area;
            return false;
          }
        }

        return true;
      },
    };

    this.bodyUid = addBodyKeyUidRelation(npcToBodyKey(this.key), w.npc.physics);

    this.moveClip = this.clips.walk;
    this.idleClip = this.clips.idle;
  }

  changeSkin(keyOrIndex: string | number) {
    const index = typeof keyOrIndex === "number" ? keyOrIndex : this.w.npc.getSkinIndex(keyOrIndex);
    if (index === -1) throw Error(`Skin "${keyOrIndex}" not found`);
    this.skinIndexUniform.value = index;
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

    this.resolve?.("spawned");

    this.mixer.clipAction(this.idleClip).play();
    this.mixer.update(0);
  };

  pinTo(result: FindNearestPolyResult) {
    if (this.agentId === null || result.success === false) {
      return false;
    }
    this.last.pinTime = this.w.timer.getElapsedTime();
    return crowdApi.requestMoveTarget(this.w.npc.crowd, this.agentId, result.nodeRef, result.position);
  }

  playIdleClip(duration = 0.1) {
    for (const clip of Object.values(this.clips)) {
      this.mixer.existingAction(clip)?.fadeOut(duration);
    }
    this.mixer.clipAction(this.idleClip).reset().fadeIn(duration).play();
  }

  startMoving(groundPoint: JshCli.GroundPoint, result: FindNearestPolyResult, arrive = true) {
    if (!this.agentId) return;

    const agent = this.w.npc.crowd.agents[this.agentId];
    // whilst walking, doors should block npcs
    agent.queryFilter = this.queryFilter;
    agent.separationWeight = walkSeparationWeight;
    agent.maxAcceleration = walkMaxAcceleration;
    agent.maxSpeed = walkAgentMaxSpeed;
    crowdApi.requestMoveTarget(this.w.npc.crowd, this.agentId, result.nodeRef, groudPointToTuple(groundPoint));

    this.last.dst = groundPoint;
    this.last.dstGrId = this.w.e.findRoomContaining(groundPoint);

    this.lookAt = null;
    this.last.blockingArea = -1;
    this.stuckAccum = 0;
    this.last.pos = { x: this.position.x, y: this.position.z };
    this.arrive = arrive;

    if (!this.moving) {
      this.moving = true;
      this.mixer.existingAction(this.idleClip)?.fadeOut(0.3);
      this.mixer.clipAction(this.moveClip).reset().fadeIn(0.3).play();
    }
  }

  startIdle() {
    this.resolve?.("idle");

    if (!this.arrive) {
      this.arrive = true;
      return;
    }

    if (this.agentId !== null) {
      const agent = this.w.npc.crowd.agents[this.agentId];

      agent.separationWeight = idleSeparationWeight;
      agent.maxSpeed = idleAgentMaxSpeed;
      agent.maxAcceleration = idleMaxAcceleration;
      this.pinTo(this.w.npc.getClosestPoly(this.position));

      const [vx, , vz] = agent.velocity;
      this.lookAt = parseGroundPoint({
        x: this.position.x + vx,
        y: this.position.z + vz,
      });
    }

    this.playIdleClip(0.3);

    this.moving = false;
    this.separating = false;
  }

  smoothRotateToward(vx: number, vz: number, delta: number) {
    const target = Math.atan2(vx, vz) + Math.PI;
    let diff = target - this.skinnedMesh.rotation.y;
    diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    this.skinnedMesh.rotation.y += diff * (1 - Math.exp(-5 * delta));
  }

  syncAnimation(speed: number) {
    if (!this.moving) return;
    const moveAction = this.mixer.clipAction(this.moveClip);
    moveAction.timeScale = (this.running ? 0.5 : 1) * Math.max(1 * (0.25 / npcScale), Math.max(speed, 0.5));
  }

  syncSeparation(agent: crowdApi.Agent, speed: number, worldSeconds: number) {
    if (!(speed > separationSpeedThreshold && worldSeconds - this.last.idleTime > separationCooldown)) {
      return;
    }
    const { clips } = this.w.npc;
    if (!this.separating) {
      this.separating = true;
      agent.maxAcceleration = idleSeparatingMaxAcceleration;
      this.mixer.existingAction(this.idleClip)?.fadeOut(0.3);
      this.mixer.clipAction(clips["shuffle-back"]).reset().fadeIn(0.3).play();
    }

    const timeScale = (1 / npcScale) * separationAnimScale * speed;
    this.mixer.clipAction(clips["shuffle-back"]).timeScale = timeScale < 0.5 ? 0 : timeScale;
  }

  updateIdle(agent: crowdApi.Agent, delta: number, worldSeconds: number) {
    const shouldSeparate = agent.neis.length > 0 && agent.neis[0].dist < neighborLookAtDist;
    if (shouldSeparate) {
      const neiAgentId = agent.neis[0].agentId;
      const neiNpc = Object.values(this.w.n).find((n) => n.agentId === neiAgentId);
      if (neiNpc?.moving === true) {
        const neighbor = this.w.npc.crowd.agents[neiAgentId];
        this.lookAt = { x: neighbor.position[0], y: neighbor.position[2] };
        const [vx, , vz] = agent.velocity;
        const speed = Math.hypot(vx, vz);
        this.syncSeparation(agent, speed, worldSeconds);
      } else {
        this.lookAt = null;
      }
    } else {
      this.lookAt = null;
      if (this.separating) {
        this.startIdle();
      }
    }

    this.updateLookAt(delta / 4);
  }

  updateLookAt(delta: number) {
    if (this.lookAt === null) return;
    const dx = this.lookAt.x - this.position.x;
    const dz = this.lookAt.y - this.position.z;
    if (dx * dx + dz * dz > 0.001) {
      this.smoothRotateToward(dx, dz, delta);
    }
  }

  updateStuck(delta: number, worldSeconds: number): boolean {
    // delay stuck a bit
    if (worldSeconds - this.last.pinTime < 2.5) {
      return false;
    }

    const dx = this.position.x - this.last.pos.x;
    const dz = this.position.z - this.last.pos.y;
    const dist = Math.hypot(dx, dz);
    this.stuckAccum += dist < 0.008 ? delta : 0;
    this.last.pos = { x: this.position.x, y: this.position.z };
    return this.stuckAccum > 0.4;
  }

  async waitUntilResolved() {
    await new Promise<string>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

export type NpcInit = {
  key: string;
  pickId: number;
  skinIndexUniform: THREE.UniformNode<"float", number>;
  labelLayerIndex: number;
  position: THREE.Vector3;
  material: THREE.MeshStandardNodeMaterial;
  shadowMaterial: THREE.MeshBasicNodeMaterial;
  labelMaterial: THREE.MeshBasicNodeMaterial;
  skinnedMesh: THREE.SkinnedMesh;
  graph: ReturnType<typeof buildGraph>;
  geometry: THREE.BufferGeometry;
};

const separationSpeedThreshold = 0.005;
const separationCooldown = 0.5;
const separationAnimScale = 1.5;
const neighborLookAtDist = 0.25;
