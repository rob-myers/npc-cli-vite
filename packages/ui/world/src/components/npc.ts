import type { UseStateRef } from "@npc-cli/util";
import { geomService } from "@npc-cli/util";
import type { buildGraph } from "@react-three/fiber";
import { deltaAngle } from "maath/misc";
import { createDefaultQueryFilter, type FindNearestPolyResult, getNodeByRef, type QueryFilter } from "navcat";
import { crowd as crowdApi } from "navcat/blocks";
import type { uniform } from "three/tsl";
import * as THREE from "three/webgpu";
import {
  idleAgentMaxSpeed,
  idleMaxAcceleration,
  idleSeparatingMaxAcceleration,
  idleSeparationWeight,
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
const rejectNoop = (_e: Error): void => {};

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
  scaleState = { delta: 0, target: 1, baseY: 0, baseX: 0, baseZ: 0 };
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
  lookAtPoint: JshCli.GroundPoint | null = null;
  lookAtState = { active: false, startAngle: 0, totalDiff: 0, duration: 0, elapsed: 0 };
  /** Synced with crowd agent */
  position: THREE.Vector3;
  moveClip = emptyAnimationClip;
  moving = false;
  queryFilter: QueryFilter;
  /** while idle and due to separationWeight */
  separating = false;
  spawns = 0;
  stuckAccum = 0;

  resolve = {
    spawn: (_k: string): void => {},
    move: (_k: string): void => {},
    scale: (_k: string): void => {},
    lookAt: (_k: string): void => {},
  };
  reject = {
    spawn: rejectNoop,
    move: rejectNoop,
    scale: rejectNoop,
    lookAt: rejectNoop,
  };

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
    this.setLabelYShift(npcLabelYShiftForClip(this.idleClip.name));
  }

  drawLabel(style?: { color?: string }) {
    const { ct } = this.w.texNpcLabel;
    const { width, height } = ct.canvas;
    ct.clearRect(0, 0, width, height);
    // ct.fillStyle = "rgba(0, 0, 0, 0.5)";
    // ct.roundRect(0, 0, width, height, 8);
    // ct.fill();
    ct.fillStyle = style?.color ?? "#fff7";
    ct.font = "400 36px sans-serif";
    ct.textAlign = "center";
    ct.textBaseline = "middle";
    ct.letterSpacing = "0.1em";
    // the label is the npc's key
    ct.fillText(this.key, width / 2, height / 2);
    this.w.texNpcLabel.updateIndex(this.labelLayerIndex);
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

    this.resolve.spawn("spawned");

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

  async scaleDown(speed = 4) {
    await new Promise<string>((resolve, reject) => {
      this.rejectAll(new Error("interrupted"));
      this.resolve.scale = resolve;
      this.reject.scale = reject;
      this.scaleState.baseX = this.position.x;
      this.scaleState.baseY = this.position.y;
      this.scaleState.baseZ = this.position.z;
      this.scaleState.target = 0;
      this.scaleState.delta = -Math.abs(speed);
    });
  }

  async scaleSpawn(at: MaybeMeta<JshCli.PointAnyFormat>) {
    let spawnY = this.position.y;
    try {
      await this.scaleDown();
      await this.w.npc.spawn({ npcKey: this.key, at });
      spawnY = this.position.y;
      this.scaleState.baseX = this.position.x;
      this.scaleState.baseY = spawnY;
      this.scaleState.baseZ = this.position.z;
      await this.scaleUp();
    } finally {
      if (this.scaleState.delta === 0) {
        this.skinnedMesh.scale.setScalar(npcScale);
        this.position.x = this.scaleState.baseX;
        this.position.y = spawnY;
        this.position.z = this.scaleState.baseZ;
        this.opacityScale.value = 1;
        this.colorScale.value = 1;
        this.material.alphaTest = 0.9;
        this.labelMaterial.visible = true;
        const bubbleDiv = this.w.b[this.key]?.html3d.rootDiv;
        if (bubbleDiv) bubbleDiv.style.opacity = "";
      }
    }
  }

  scaleTick(delta: number) {
    if (this.scaleState.delta === 0) return;
    const current = this.skinnedMesh.scale.x / npcScale;
    const next = current + this.scaleState.delta * delta;
    const done = this.scaleState.delta > 0 ? next >= this.scaleState.target : next <= this.scaleState.target;
    const s = Math.max(0, done ? this.scaleState.target : next);

    if (this.idleClip.name === "lie") {
      // Root bone is at head; stomach is half the standing height along the facing direction
      const ry = this.skinnedMesh.rotation.y;
      const halfH = 0.4;
      this.skinnedMesh.scale.setScalar(npcScale * s);
      this.position.x = this.scaleState.baseX + -Math.sin(ry) * halfH * (1 - s);
      this.position.z = this.scaleState.baseZ + -Math.cos(ry) * halfH * (1 - s);
    } else {
      this.skinnedMesh.scale.setScalar(npcScale * s);
      this.position.y = this.scaleState.baseY + scaleCenterY(this.idleClip.name) * (1 - s);
    }

    this.bubbleOffset.y = npcBubbleHeightForClip(this.idleClip.name) * s;
    this.labelMaterial.visible = s >= 1;
    const bubbleDiv = this.w.b[this.key]?.html3d.rootDiv;
    if (bubbleDiv) bubbleDiv.style.opacity = s < 1 ? "0" : "";
    this.colorScale.value = next;
    this.opacityScale.value = next;
    this.material.alphaTest = next - 0.01;

    if (done) {
      this.scaleState.delta = 0;
      this.resolve.scale("scale");
    }
  }

  async scaleUp(speed = 4) {
    await new Promise<string>((resolve, reject) => {
      this.rejectAll(new Error("interrupted"));
      this.resolve.scale = resolve;
      this.reject.scale = reject;
      this.scaleState.target = 1;
      this.scaleState.delta = Math.abs(speed);
    });
  }

  setLabelYShift(shift: number) {
    this.labelYShiftUniform.value = shift;
  }

  setSkin(skinKey?: string) {
    const skinIndex = this.w.npc.getSkinIndex(skinKey ?? "medic-0");
    console.warn(`${this.key}: skin "${skinKey}" not found`);
    this.skinIndexUniform.value = skinIndex;
  }

  async lookAt(at: MaybeMeta<JshCli.PointAnyFormat>, { angularVelocity = 2 * Math.PI, immediate = false } = {}) {
    const p = parseGroundPoint(at);
    const dx = p.x - this.position.x;
    const dz = p.y - this.position.z;
    const target = geomService.getThreeRotationY(dz, dx);
    if (immediate) {
      this.skinnedMesh.rotation.y = target;
      return;
    }
    await new Promise<string>((resolve, reject) => {
      this.rejectAll(new Error("interrupted"));
      this.resolve.lookAt = resolve;
      this.reject.lookAt = reject;
      const startAngle = this.skinnedMesh.rotation.y;
      const totalDiff = deltaAngle(startAngle, target);
      // quadratic ease-out: T = 2|arc| / v0 so initial speed equals angularVelocity
      const duration = Math.abs(totalDiff) < 0.001 ? 0 : (2 * Math.abs(totalDiff)) / Math.abs(angularVelocity);
      Object.assign(this.lookAtState, { active: true, startAngle, totalDiff, duration, elapsed: 0 });
    });
  }

  lookAtTick(delta: number) {
    if (!this.lookAtState.active) return;
    const s = this.lookAtState;
    s.elapsed += delta;
    if (s.elapsed >= s.duration) {
      this.skinnedMesh.rotation.y = s.startAngle + s.totalDiff;
      s.active = false;
      this.resolve.lookAt("lookAt");
    } else {
      const t = s.elapsed / s.duration;
      // ease-out: p(t) = 2t - t², velocity starts at v0 and falls to 0
      this.skinnedMesh.rotation.y = s.startAngle + s.totalDiff * (2 * t - t * t);
    }
  }

  rejectAll(err: Error) {
    const { reject } = this;
    this.reject = { spawn: rejectNoop, move: rejectNoop, scale: rejectNoop, lookAt: rejectNoop };
    // synchronously stop scale or look
    this.scaleState.delta = 0;
    this.lookAtState.active = false;
    reject.spawn(err);
    reject.move(err);
    reject.scale(err);
    reject.lookAt(err);
  }

  smoothRotateToward(vx: number, vz: number, delta: number) {
    const target = Math.atan2(vx, vz) + Math.PI;
    let diff = target - this.skinnedMesh.rotation.y;
    diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    this.skinnedMesh.rotation.y += diff * (1 - Math.exp(-5 * delta));
  }

  startIdle({ force = false } = {}) {
    this.resolve.move("idle");

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
      this.lookAtPoint = parseGroundPoint({
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
    console.log("startMoving", { groundPoint, result, arrive });
    const agent = this.w.npc.crowd.agents[this.agentId];
    // whilst walking, doors should block npcs
    agent.queryFilter = this.queryFilter;
    agent.separationWeight = walkSeparationWeight;
    agent.maxAcceleration = walkMaxAcceleration;
    agent.maxSpeed = walkAgentMaxSpeed;
    crowdApi.requestMoveTarget(this.w.npc.crowd, this.agentId, result.nodeRef, groundPointToTuple(groundPoint));

    this.last.dst = groundPoint;
    this.last.dstGrId = this.w.e.findRoomContaining(groundPoint);

    this.lookAtPoint = null;
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
        this.lookAtPoint = { x: neighbor.position[0], y: neighbor.position[2] };
        const [vx, , vz] = agent.velocity;
        const speed = Math.hypot(vx, vz);
        this.syncSeparation(agent, speed, worldSeconds);
      } else {
        this.lookAtPoint = null;
      }
    } else {
      this.lookAtPoint = null;
      if (this.separating) {
        this.startIdle();
      }
    }

    this.updateLookAt(delta / 4);
  }

  updateLookAt(delta: number) {
    if (this.lookAtPoint === null) return;
    const dx = this.lookAtPoint.x - this.position.x;
    const dz = this.lookAtPoint.y - this.position.z;
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
      this.rejectAll(new Error("interrupted"));
      this.resolve.move = resolve;
      this.reject.move = reject;
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

function scaleCenterY(clipName: string): number {
  if (clipName === "sit") return 0;
  return npcBubbleHeightForClip(clipName) / 2;
}

export function npcBubbleHeightForClip(clipName: string): number {
  if (clipName === "sit") return 1.4;
  if (clipName === "lie") return 0.9;
  return 2;
}

// 🚧 why don't these correspond to world meters?
export function npcLabelYShiftForClip(clipName: string): number {
  if (clipName === "sit") return 1.6;
  if (clipName === "lie") return 0.75;
  return 2.2;
}
