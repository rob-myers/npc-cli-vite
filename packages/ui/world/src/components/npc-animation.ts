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
  runAgentMaxSpeed,
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
   * Arrive is `true` iff when npc moves it should slow down before final destination.
   * It can be set via `npc.move` or alternatively via `npc.preventArrive` during move.
   */
  arrive = true;
  fadeState = { delta: 0, target: 1 };
  lookState = { active: false, startAngle: 0, totalDiff: 0, duration: 0, elapsed: 0, longLook: false };
  /** true iff moving via agent in navmesh */
  moving = false;
  stuckAccum = 0;

  idleClip = emptyAnimationClip;
  mixer = emptyMixer;
  moveClip = emptyAnimationClip;

  constructor(npc: Npc) {
    this.npc = npc;
  }

  get w(): UseStateRef<import("./World").State> {
    return this.npc.w;
  }

  fadeTick(deltaSecs: number) {
    if (this.fadeState.delta === 0) {
      return;
    }

    const { delta, target } = this.fadeState;

    if (delta < 0) {
      // fade color out to black, then (once black) fade opacity out
      if (this.npc.colorScale.value > target) {
        const next = Math.max(target, this.npc.colorScale.value + 4 * delta * deltaSecs);
        this.npc.labelVisible.value = next >= 1 ? 1 : 0;
        this.npc.alphaTest.value = Math.min(0.9, Math.max(0, next - 0.2));
        this.npc.colorScale.value = next;

        if (next <= target) {
          // just faded to black
          this.npc.material.depthWrite = false;
        }
      } else {
        const next = Math.max(target, this.npc.opacityScale.value + delta * deltaSecs);
        this.npc.opacityScale.value = next;

        if (next <= target) {
          this.fadeState.delta = 0;
          this.npc.material.needsUpdate = true;
          this.npc.resolve.fade("fade");
        }
      }
    } else {
      // before fading color in from black, fade opacity in
      if (this.npc.opacityScale.value < target) {
        const next = Math.min(target, this.npc.opacityScale.value + delta * deltaSecs);
        this.npc.opacityScale.value = next;

        if (next >= target) {
          this.npc.material.depthWrite = true;
        }
      } else {
        const next = Math.min(target, this.npc.colorScale.value + delta * deltaSecs);
        this.npc.labelVisible.value = next >= 1 ? 1 : 0;
        this.npc.alphaTest.value = Math.min(0.9, Math.max(0, next - 0.2));
        this.npc.colorScale.value = next;

        if (next >= target) {
          this.fadeState.delta = 0;
          this.npc.material.needsUpdate = true;
          this.npc.resolve.fade("fade");
        }
      }
    }
  }

  lookTick(delta: number) {
    const s = this.lookState;
    if (!s.active) {
      return;
    }

    s.elapsed += delta;

    if (s.elapsed >= s.duration) {
      this.npc.rotation.y = s.startAngle + s.totalDiff;
      s.active = false;
      if (s.longLook) {
        s.longLook = false;
        this.playIdleClip(0.3);
      }
      this.npc.resolve.look("lookAt");
    } else {
      // ease-out: p(t) = 2t - t², velocity starts at v0 and falls to 0
      const t = s.elapsed / s.duration;
      this.npc.rotation.y = s.startAngle + s.totalDiff * (2 * t - t * t);
    }
  }

  playIdleClip(duration = 0.1, idleClip = this.idleClip) {
    // fading all clips prevents e.g. sit from continuing
    for (const clip of Object.values(this.npc.clips)) {
      if (clip === idleClip) continue;
      this.mixer.existingAction(clip)?.fadeOut(duration);
    }

    if ((this.mixer.existingAction(idleClip)?.getEffectiveWeight() ?? 0) > 0) {
      return;
    }

    this.mixer.clipAction(idleClip).reset().fadeIn(duration).play();
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
    agent.maxSpeed = this.moveClip.name === "run" ? runAgentMaxSpeed : walkAgentMaxSpeed;

    crowdApi.requestMoveTarget(
      this.w.npc.crowd,
      this.npc.agentId as string,
      result.nodeRef,
      groundPointToTuple(groundPoint),
    );

    // track destination for checkNpcTargetUnreachable
    const { last } = this.npc;
    last.dst = groundPoint;
    last.dstGrId = this.w.e.findRoomContaining(groundPoint);
    last.blockingArea = -1;
    last.navNodeRef = -1;
    last.pos = this.npc.point;

    this.npc.nodeCount = 0;
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
