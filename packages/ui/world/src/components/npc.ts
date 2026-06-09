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
  npcBubbleHeightLying,
  npcBubbleHeightSitting,
  npcBubbleHeightStanding,
  npcScale,
  walkAgentMaxSpeed,
  walkMaxAcceleration,
  walkSeparationWeight,
} from "../const";
import { groundPointToTuple, parseGroundPoint } from "../service/geometry";
import { addBodyKeyUidRelation, npcToBodyKey } from "../service/physics-bijection";
import { emptyAnimationClip } from "../service/three-animation";
import { decodeDoorAreaId, isDoorAreaId } from "../worker/nav-util";

const emptyAnimationMixer = new THREE.AnimationMixer({} as THREE.Object3D);

export class Npc {
  key: string;

  /** Physics body */
  bodyUid: number;
  colorScale: THREE.UniformNode<"float", number>;

  geometry: THREE.BufferGeometry;
  graph: ReturnType<typeof buildGraph>;
  group: THREE.Group | null = null;
  /** Points into ArrayTexture */
  labelLayerIndex: number;
  labelMaterial: THREE.MeshBasicNodeMaterial;
  labelYShiftUniform: THREE.UniformNode<"float", number>;
  material: THREE.MeshStandardNodeMaterial;
  mixer: THREE.AnimationMixer = emptyAnimationMixer;
  opacityScale: THREE.UniformNode<"float", number>;
  /** Expect ≤ 200 npcs but technically ≤ 65535 */
  pickId: number;
  shadowMaterial: THREE.MeshBasicNodeMaterial;
  skinnedMesh: THREE.SkinnedMesh;
  /** Skin selection */
  skinIndexUniform: ReturnType<typeof uniform<"float", number>>;

  arrive = true;
  agentId: string | null = null;
  bubbleOffset = new THREE.Vector3(0, 0, 0);
  fadeState = {
    colorDelta: 0,
    colorTarget: 1,
    opacityDelta: 0,
    opacityTarget: 1,
  };
  doorKeys = {} as { [key: `g${number}d${number}`]: boolean };
  idleClip = emptyAnimationClip;
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
  moveClip = emptyAnimationClip;
  moving = false;
  queryFilter: QueryFilter;
  /** while idle and due to separationWeight */
  separating = false;
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
    this.colorScale = init.colorScale;
    this.geometry = init.geometry;
    this.graph = init.graph;
    this.labelLayerIndex = init.labelLayerIndex;
    this.labelMaterial = init.labelMaterial;
    this.labelYShiftUniform = init.labelYShiftUniform;
    this.material = init.material;
    this.opacityScale = init.opacityScale;
    this.pickId = init.pickId;
    this.position = init.position;
    this.shadowMaterial = init.shadowMaterial;
    this.skinnedMesh = init.skinnedMesh;
    this.skinIndexUniform = init.skinIndexUniform;

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
    this.bubbleOffset.y = npcBubbleHeightForClip(this.idleClip.name);
    this.setLabelYShift(0);
  }

  /** Fade to black/white or fade opacity in/out. Speed is units/second. */
  async fade(type: "black" | "white" | "out" | "in", speed = 5) {
    try {
      await new Promise((resolve, reject) => {
        this.resolve = resolve;
        this.reject = reject;
        switch (type) {
          case "black":
            this.fadeState.colorTarget = 0;
            this.fadeState.colorDelta = -Math.abs(speed);
            break;
          case "white":
            this.fadeState.colorTarget = 1;
            this.fadeState.colorDelta = Math.abs(speed);
            break;
          case "out":
            this.fadeState.opacityTarget = 0;
            this.fadeState.opacityDelta = -Math.abs(speed);
            break;
          case "in":
            this.fadeState.opacityTarget = 1;
            this.fadeState.opacityDelta = Math.abs(speed);
            break;
          default:
            throw Error(`unknown fade type "${type}"`);
        }
      });
    } finally {
      this.fadeState.colorDelta = 0;
      this.fadeState.opacityDelta = 0;
    }
  }

  async fadeSpawn(at: MaybeMeta<JshCli.PointAnyFormat>) {
    try {
      await this.fade("black", 2.5);
      await this.fade("out", 5);
      await this.w.npc.spawn({ npcKey: this.key, at });
      await this.fade("in", 5);
      await this.fade("white", 5);
    } finally {
      this.fadeState.colorDelta = 0;
      this.fadeState.opacityDelta = 0;
      this.opacityScale.value = 1;
      this.colorScale.value = 1;
    }
  }

  fadeTick(delta: number) {
    if (this.fadeState.colorDelta !== 0) {
      const next = this.colorScale.value + this.fadeState.colorDelta * delta;
      const done =
        this.fadeState.colorDelta > 0 ? next >= this.fadeState.colorTarget : next <= this.fadeState.colorTarget;
      this.colorScale.value = done ? this.fadeState.colorTarget : next;
      // when uniformly black can turn off depthWrite for subsequent opacity fade
      this.material.depthWrite = this.colorScale.value > 0;
      if (done === true) {
        this.fadeState.colorDelta = 0;
        this.resolve?.("fade-color");
      }
    }
    if (this.fadeState.opacityDelta !== 0) {
      const next = this.opacityScale.value + this.fadeState.opacityDelta * delta;
      const done =
        this.fadeState.opacityDelta > 0 ? next >= this.fadeState.opacityTarget : next <= this.fadeState.opacityTarget;
      this.opacityScale.value = done ? this.fadeState.opacityTarget : next;
      // avoid sudden disappearance
      this.material.alphaTest = Math.max(0, this.opacityScale.value - 0.01);
      if (done === true) {
        this.fadeState.opacityDelta = 0;
        this.resolve?.("fade-opacity");
      }
    }
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

  setLabelYShift(shift: number) {
    this.labelYShiftUniform.value = shift;
  }

  setSkin(skinKey?: string) {
    const skinIndex = this.w.npc.getSkinIndex(skinKey ?? "medic-0");
    console.warn(`${this.key}: skin "${skinKey}" not found`);
    this.skinIndexUniform.value = skinIndex;
  }

  smoothRotateToward(vx: number, vz: number, delta: number) {
    const target = Math.atan2(vx, vz) + Math.PI;
    let diff = target - this.skinnedMesh.rotation.y;
    diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    this.skinnedMesh.rotation.y += diff * (1 - Math.exp(-5 * delta));
  }

  startIdle({ force = false } = {}) {
    this.resolve?.("idle");

    if (!this.arrive && !force) {
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
    this.bubbleOffset.y = npcBubbleHeightForClip(this.idleClip.name);
    this.setLabelYShift(npcLabelYShiftForClip(this.idleClip.name));

    this.moving = false;
    this.separating = false;
    this.arrive = true;
  }

  startMoving(groundPoint: JshCli.GroundPoint, result: FindNearestPolyResult, arrive = true) {
    if (!this.agentId) return;

    const agent = this.w.npc.crowd.agents[this.agentId];
    // whilst walking, doors should block npcs
    agent.queryFilter = this.queryFilter;
    agent.separationWeight = walkSeparationWeight;
    agent.maxAcceleration = walkMaxAcceleration;
    agent.maxSpeed = walkAgentMaxSpeed;
    crowdApi.requestMoveTarget(this.w.npc.crowd, this.agentId, result.nodeRef, groundPointToTuple(groundPoint));

    this.last.dst = groundPoint;
    this.last.dstGrId = this.w.e.findRoomContaining(groundPoint);

    this.lookAt = null;
    this.last.blockingArea = -1;
    this.stuckAccum = 0;
    this.last.pos = { x: this.position.x, y: this.position.z };
    this.arrive = arrive;

    if (!this.moving) {
      this.moving = true;
      this.bubbleOffset.y = npcBubbleHeightForClip(this.moveClip.name);
      this.setLabelYShift(npcLabelYShiftForClip(this.moveClip.name));
      this.mixer.existingAction(this.idleClip)?.fadeOut(0.3);
      this.mixer.clipAction(this.moveClip).reset().fadeIn(0.3).play();
    }
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
  colorScale: THREE.UniformNode<"float", number>;
  geometry: THREE.BufferGeometry;
  graph: ReturnType<typeof buildGraph>;
  pickId: number;
  labelLayerIndex: number;
  labelMaterial: THREE.MeshBasicNodeMaterial;
  labelYShiftUniform: THREE.UniformNode<"float", number>;
  material: THREE.MeshStandardNodeMaterial;
  opacityScale: THREE.UniformNode<"float", number>;
  position: THREE.Vector3;
  shadowMaterial: THREE.MeshBasicNodeMaterial;
  skinIndexUniform: THREE.UniformNode<"float", number>;
  skinnedMesh: THREE.SkinnedMesh;
};

const separationSpeedThreshold = 0.005;
const separationCooldown = 0.5;
const separationAnimScale = 1.5;
const neighborLookAtDist = 0.25;

export function npcBubbleHeightForClip(clipName: string): number {
  if (clipName === "sit") return npcBubbleHeightSitting;
  if (clipName === "lie") return npcBubbleHeightLying;
  return npcBubbleHeightStanding;
}

// 🚧 why don't these correspond to world meters?
export function npcLabelYShiftForClip(clipName: string): number {
  if (clipName === "sit") return 1.6;
  if (clipName === "lie") return 0.75;
  return 2.2;
}
