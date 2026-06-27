import type { UseStateRef } from "@npc-cli/util";
import type { FindNearestPolyResult } from "navcat";
import { crowd as crowdApi } from "navcat/blocks";
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
import { emptyAnimationClip } from "../service/three-animation";
import type { Npc } from "./npc";

const emptyMixer = new THREE.AnimationMixer({} as THREE.Object3D);

export class NpcAnimation {
  npc: Npc;

  arrive = true;
  idleClip: THREE.AnimationClip = emptyAnimationClip;
  fadeState = { delta: 0, target: 1 };
  lookAtPoint: JshCli.GroundPoint | null = null;
  lookAtState = { active: false, startAngle: 0, totalDiff: 0, duration: 0, elapsed: 0, walking: false };
  mixer: THREE.AnimationMixer = emptyMixer;
  moveClip: THREE.AnimationClip = emptyAnimationClip;
  moving = false;
  separating = false;
  stuckAccum = 0;

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
    if (this.fadeState.delta === 0) return;
    const current = this.npc.opacityScale.value;
    const next = current + this.fadeState.delta * delta;
    const done = this.fadeState.delta > 0 ? next >= this.fadeState.target : next <= this.fadeState.target;
    const s = Math.max(0, done ? this.fadeState.target : next);

    this.npc.labelVisible.value = s >= 1 ? 1 : 0;
    this.npc.colorScale.value = next;
    this.npc.opacityScale.value = next;
    this.npc.alphaTestScale.value = s >= 1 ? 0.9 : Math.max(0, s - 0.2);
    this.npc.material.depthWrite = next > 0.2;

    if (done) {
      this.fadeState.delta = 0;
      this.npc.material.needsUpdate = true;
      this.npc.resolve.scale("scale");
    }
  }

  lookTick(delta: number) {
    if (!this.lookAtState.active) return;

    const s = this.lookAtState;
    s.elapsed += delta;

    if (s.elapsed >= s.duration) {
      this.npc.skinnedMesh.rotation.y = s.startAngle + s.totalDiff;
      s.active = false;
      if (s.walking) {
        s.walking = false;
        this.playIdleClip(0.3);
      }
      this.npc.resolve.look("lookAt");
    } else {
      const t = s.elapsed / s.duration;
      // ease-out: p(t) = 2t - t², velocity starts at v0 and falls to 0
      this.npc.skinnedMesh.rotation.y = s.startAngle + s.totalDiff * (2 * t - t * t);
    }
  }

  playIdleClip(duration = 0.1) {
    for (const clip of Object.values(this.w.npc.clips)) {
      this.mixer.existingAction(clip)?.fadeOut(duration);
    }
    this.mixer.clipAction(this.idleClip).reset().fadeIn(duration).play();
  }

  smoothRotateToward(vx: number, vz: number, delta: number) {
    const target = Math.atan2(vx, vz) + Math.PI;
    let diff = target - this.npc.skinnedMesh.rotation.y;
    diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (diff < -Math.PI) diff += Math.PI * 2;
    this.npc.skinnedMesh.rotation.y += diff * (1 - Math.exp(-5 * delta));
  }

  startIdle({ force = false } = {}) {
    this.npc.resolve.move("idle");

    if (!this.arrive && !force) {
      this.arrive = true;
      return;
    }

    if (this.npc.agentId !== null) {
      const agent = this.w.npc.crowd.agents[this.npc.agentId];

      agent.separationWeight = idleSeparationWeight;
      agent.maxSpeed = idleAgentMaxSpeed;
      agent.maxAcceleration = idleMaxAcceleration;

      const [vx, , vz] = agent.velocity;
      const speed = Math.hypot(vx, vz);
      // pin ahead by stopping distance v²/2a so agent decelerates without reversing
      const pinAhead = speed ** 2 / (2 * idleMaxAcceleration);
      const pinX = this.npc.position.x + (vx / (speed || 1)) * pinAhead;
      const pinZ = this.npc.position.z + (vz / (speed || 1)) * pinAhead;
      this.npc.pinTo(this.w.npc.getClosestPoly({ x: pinX, y: pinZ }));

      this.lookAtPoint = parseGroundPoint({
        x: this.npc.position.x + vx,
        y: this.npc.position.z + vz,
      });
    }

    this.playIdleClip(0.3);
    this.npc.bubbleOffset.y = bubbleHeightForClip(this.idleClip.name);
    this.npc.setLabelYShift(labelYShiftForClip(this.idleClip.name));

    this.moving = false;
    this.separating = false;
    this.arrive = true;
  }

  startMoving(groundPoint: JshCli.GroundPoint, result: FindNearestPolyResult, arrive = true) {
    if (!this.npc.agentId) return;
    const agent = this.w.npc.crowd.agents[this.npc.agentId];
    // whilst walking, doors should block npcs
    agent.queryFilter = this.npc.queryFilter;
    agent.separationWeight = walkSeparationWeight;
    agent.maxAcceleration = walkMaxAcceleration;
    agent.maxSpeed = walkAgentMaxSpeed;
    crowdApi.requestMoveTarget(this.w.npc.crowd, this.npc.agentId, result.nodeRef, groundPointToTuple(groundPoint));

    this.npc.last.dst = groundPoint;
    this.npc.last.dstGrId = this.w.e.findRoomContaining(groundPoint);

    this.lookAtPoint = null;
    this.npc.last.blockingArea = -1;
    this.stuckAccum = 0;
    this.npc.last.pos = { x: this.npc.position.x, y: this.npc.position.z };
    this.arrive = arrive;

    if (!this.moving) {
      this.moving = true;
      this.npc.bubbleOffset.y = bubbleHeightForClip(this.moveClip.name);
      this.npc.setLabelYShift(labelYShiftForClip(this.moveClip.name));
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
    if (!(speed > separationSpeedThreshold && worldSeconds - this.npc.last.idleTime > separationCooldown)) {
      return;
    }

    const { clips } = this.w.npc;
    if (!this.separating) {
      this.separating = true;
      agent.maxAcceleration = idleSeparatingMaxAcceleration;
      this.mixer.existingAction(this.idleClip)?.fadeOut(0.3);
      this.mixer.clipAction(clips.stand).reset().fadeIn(0.3).play();
    }

    const timeScale = (1 / npcScale) * separationAnimScale * speed;
    this.mixer.clipAction(clips.stand).timeScale = timeScale < 0.5 ? 0 : timeScale;
  }

  updateIdle(agent: crowdApi.Agent, delta: number, worldSeconds: number) {
    const shouldSeparate = agent.neis.length > 0 && agent.neis[0].dist < neighborLookAtDist;

    if (shouldSeparate) {
      const neiAgentId = agent.neis[0].agentId;
      const neiNpc = Object.values(this.w.n).find((n) => n.agentId === neiAgentId);
      if (neiNpc?.anim.moving === true) {
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

    this.updateLookAt(delta / 2);
  }

  updateLookAt(delta: number) {
    if (this.lookAtPoint === null) return;
    const dx = this.lookAtPoint.x - this.npc.position.x;
    const dz = this.lookAtPoint.y - this.npc.position.z;
    if (dx * dx + dz * dz > 0.001) {
      this.smoothRotateToward(dx, dz, delta);
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
    this.stuckAccum += dist < 0.008 ? delta : 0;
    this.npc.last.pos = { x: this.npc.position.x, y: this.npc.position.z };
    return this.stuckAccum > 0.4;
  }
}

const separationSpeedThreshold = 0.005;
const separationCooldown = 0.5;
const separationAnimScale = 1.5;
const neighborLookAtDist = 0.25;

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
