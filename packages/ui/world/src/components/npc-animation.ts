import type { UseStateRef } from "@npc-cli/util";
import { deltaAngle } from "maath/misc";
import type { FindNearestPolyResult } from "navcat";
import { crowd as crowdApi } from "navcat/blocks";
import * as THREE from "three/webgpu";
import {
  idleAgentMaxSpeed,
  idleMaxAcceleration,
  idleSeparationWeight,
  npcScale,
  walkAgentMaxSpeed,
  walkMaxAcceleration,
  walkSeparationWeight,
} from "../const";
import { groundPointToTuple } from "../service/geometry";
import { emptyAnimationClip } from "../service/three-animation";
import type { AnimationClipKey } from "./NPCs";
import type { Npc } from "./npc";

const emptyMixer = new THREE.AnimationMixer({} as THREE.Object3D);

export class NpcAnimation {
  npc: Npc;

  /**
   * - true iff when npc moving it should slow down before final destination
   * - set via `move` or `preventArrive` during move
   */
  arrive = true;
  idleClip: THREE.AnimationClip = emptyAnimationClip;
  fadeState = { delta: 0, target: 1 };
  lookAtState = { active: false, startAngle: 0, totalDiff: 0, duration: 0, elapsed: 0, walking: false };
  mixer: THREE.AnimationMixer = emptyMixer;
  moveClip: THREE.AnimationClip = emptyAnimationClip;
  /** true iff moving via agent in navmesh */
  moving = false;
  /** true iff idle and separating from moving agent */
  separating = false;
  stuckAccum = 0;

  closeStrategy = null as null | ((npc: Npc, agent: crowdApi.Agent) => void);

  constructor(npc: Npc) {
    this.npc = npc;
  }

  get w(): UseStateRef<import("./World").State> {
    return this.npc.w;
  }

  get running() {
    return this.moveClip.name === "run";
  }

  fadeTick(delta: number) {
    if (this.fadeState.delta === 0) {
      return;
    }

    const current = this.npc.opacityScale.value;
    const next = current + this.fadeState.delta * delta;
    const finished = this.fadeState.delta > 0 ? next >= this.fadeState.target : next <= this.fadeState.target;
    const s = Math.max(0, finished ? this.fadeState.target : next);

    this.npc.labelVisible.value = s >= 1 ? 1 : 0;
    this.npc.alphaTestScale.value = Math.min(0.9, Math.max(0, s - 0.2));
    this.npc.colorScale.value = next;
    this.npc.opacityScale.value = next;
    this.npc.material.depthWrite = next > 0.2;

    if (finished === true) {
      this.fadeState.delta = 0;
      this.npc.material.needsUpdate = true;
      this.npc.resolve.scale("scale");
    }
  }

  lookTick(delta: number) {
    const s = this.lookAtState;
    if (!s.active) {
      return;
    }

    s.elapsed += delta;

    if (s.elapsed >= s.duration) {
      this.npc.rotation.y = s.startAngle + s.totalDiff;
      s.active = false;
      if (s.walking) {
        s.walking = false;
        this.playIdleClip(0.3);
      }
      this.npc.resolve.look("lookAt");
    } else {
      // ease-out: p(t) = 2t - t², velocity starts at v0 and falls to 0
      const t = s.elapsed / s.duration;
      this.npc.rotation.y = s.startAngle + s.totalDiff * (2 * t - t * t);
    }
  }

  playIdleClip(duration = 0.1) {
    // fading all clips prevents e.g. sit from continuing
    for (const clip of Object.values(this.npc.clips)) {
      if (clip === this.idleClip) continue;
      this.mixer.existingAction(clip)?.fadeOut(duration);
    }

    if ((this.mixer.existingAction(this.idleClip)?.getEffectiveWeight() ?? 0) > 0) {
      return;
    }

    this.mixer.clipAction(this.idleClip).reset().fadeIn(duration).play();
  }

  rotateTowards(vx: number, vz: number, delta: number) {
    const target = Math.atan2(vx, vz) + Math.PI;
    const diff = deltaAngle(this.npc.rotation.y, target);
    this.npc.rotation.y += diff * (1 - Math.exp(-5 * delta));
  }

  startIdle({ force = false } = {}) {
    this.npc.resolve.move("idle");

    const skip = !this.arrive && !force;
    this.arrive = true;

    if (skip) {
      return;
    }

    const agent = this.npc.agent;

    if (agent) {
      agent.separationWeight = idleSeparationWeight;
      agent.maxAcceleration = idleMaxAcceleration;
      agent.maxSpeed = idleAgentMaxSpeed;
      const [vx, , vz] = agent.velocity;

      // pin ahead by stopping distance v²/2a so agent decelerates without reversing
      const speed = Math.hypot(vx, vz);
      const pinAhead = speed ** 2 / (2 * idleMaxAcceleration);
      const pinX = this.npc.position.x + (vx / (speed || 1)) * pinAhead;
      const pinZ = this.npc.position.z + (vz / (speed || 1)) * pinAhead;
      this.npc.pinTo(this.w.npc.getClosestPoly({ x: pinX, y: pinZ }));
    }

    this.playIdleClip(0.3);
    this.npc.setBubbleHeight(bubbleHeightForClip(this.idleClip.name));
    this.npc.setLabelYShift(labelYShiftForClip(this.idleClip.name));

    this.moving = false;
    this.separating = false;
  }

  startMoving(groundPoint: JshCli.GroundPoint, result: FindNearestPolyResult, arrive = true) {
    const agent = this.npc.agent;
    if (!agent) {
      throw Error(`cannot move without agent: ${this.npc.key}`);
    }

    // whilst walking, doors should block npcs
    agent.queryFilter = this.npc.queryFilter;
    agent.separationWeight = walkSeparationWeight;
    agent.maxAcceleration = walkMaxAcceleration;
    agent.maxSpeed = walkAgentMaxSpeed;
    crowdApi.requestMoveTarget(
      this.w.npc.crowd,
      this.npc.agentId as string,
      result.nodeRef,
      groundPointToTuple(groundPoint),
    );

    // track destination for checkNpcTargetUnreachable
    this.npc.last.dst = groundPoint;
    this.npc.last.dstGrId = this.w.e.findRoomContaining(groundPoint);
    this.npc.last.blockingArea = -1;
    this.npc.last.pos = this.npc.point;

    this.stuckAccum = 0;
    this.arrive = arrive;

    if (this.moving) {
      return;
    }

    this.moving = true;
    this.npc.setBubbleHeight(bubbleHeightForClip(this.moveClip.name));
    this.npc.setLabelYShift(labelYShiftForClip(this.moveClip.name));

    this.mixer.existingAction(this.idleClip)?.fadeOut(0.3);
    this.mixer.clipAction(this.moveClip).reset().fadeIn(0.3).play();
  }

  syncAnimation(speed: number) {
    if (!this.moving) return;
    const moveAction = this.mixer.clipAction(this.moveClip);
    const moveClipKey = this.moveClip.name as AnimationClipKey;
    moveAction.timeScale = (moveClipKey === "run" ? 0.5 : 1) * Math.max(1 * (0.25 / npcScale), Math.max(speed, 0.5));
  }

  updateIdle(agent: crowdApi.Agent, worldSeconds: number) {
    const closestMovingNei = agent.neis.find((nei) => this.w.npc.byAgentId[nei.agentId]?.anim.moving === true);
    const closestNeiTooClose = closestMovingNei !== undefined && closestMovingNei.dist < neighborShouldSeparateDist;

    if (!closestNeiTooClose) {
      if (this.separating) this.startIdle();
      return;
    }

    if (!this.separating && worldSeconds - this.npc.last.idleTime > separationCooldown) {
      // commence separation
      this.separating = true;
      (this.closeStrategy ?? this.w.npc.closeStrategy.slideToEdge)(this.npc, agent);
    }
  }

  updateStuck(delta: number, worldSeconds: number): boolean {
    // delay stuck a bit
    if (worldSeconds - this.npc.last.pinTime < 2.5) {
      return false;
    }

    const dx = this.npc.position.x - this.npc.last.pos.x;
    const dz = this.npc.position.z - this.npc.last.pos.y;
    const dist = Math.hypot(dx, dz);
    this.stuckAccum += dist < 0.002 ? delta : 0;
    this.npc.last.pos = { x: this.npc.position.x, y: this.npc.position.z };
    return this.stuckAccum > 0.4;
  }
}

const separationCooldown = 0.5;
const neighborShouldSeparateDist = 0.25;

function bubbleHeightForClip(clipName: string): number {
  if (clipName === "sit") return 1.4;
  if (clipName === "lie") return 0.9;
  return 2;
}

function labelYShiftForClip(clipName: string): number {
  if (clipName === "sit") return 1.6;
  if (clipName === "lie") return 0.75;
  return 2.2;
}
