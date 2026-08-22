import type { UseStateRef } from "@npc-cli/util";
import { deltaAngle } from "maath/misc";
import type { FindNearestPolyResult } from "navcat";
import { crowd as crowdApi } from "navcat/blocks";
import * as THREE from "three/webgpu";
import {
  defaultFadeSecs,
  fadeSecs,
  idleAgentMaxSpeed,
  idleMaxAcceleration,
  idleSeparationWeight,
  npcConfig,
  npcScale,
  runAgentMaxSpeed,
  walkAgentMaxSpeed,
  walkMaxAcceleration,
  walkSeparationWeight,
} from "../const";
import { helper } from "../service/helper";
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
      if (this.npc.colorScale.value > target) {
        const next = Math.max(target, this.npc.colorScale.value + 0.5 * delta * deltaSecs);
        this.npc.labelVisible.value = next >= 1 ? 1 : 0;
        this.npc.colorScale.value = next;
      } else {
        this.fadeState.delta = 0;
        this.npc.material.needsUpdate = true;
        this.npc.resolve.fade("fade");
      }
    } else {
      const next = Math.min(target, this.npc.colorScale.value + 0.5 * delta * deltaSecs);
      this.npc.labelVisible.value = next >= 1 ? 1 : 0;
      this.npc.colorScale.value = next;

      if (next >= target) {
        this.fadeState.delta = 0;
        this.npc.material.needsUpdate = true;
        this.npc.resolve.fade("fade");
      }
    }
  }

  lookTick(delta: number) {
    const s = this.lookState;
    if (!s.active) {
      return;
    }

    s.elapsed += delta;

    // begin crossfading back early, so the shuffle has become idle just as the turn lands.
    // Clamped, else a turn shorter than the fade would start it before it had begun
    if (s.longLook === true) {
      const idleFade = Math.min(lookIdleFadeMs / 1000, s.duration);
      if (s.elapsed >= s.duration - idleFade) {
        s.longLook = false;
        this.playIdleClip(idleFade);
      }
    }

    if (s.elapsed >= s.duration) {
      this.npc.rotation.y = s.startAngle + s.totalDiff;
      s.active = false;
      this.npc.resolve.look("lookAt");
    } else {
      // ease-out: p(t) = 2t - t², velocity starts at v0 and falls to 0
      const t = s.elapsed / s.duration;
      this.npc.rotation.y = s.startAngle + s.totalDiff * (2 * t - t * t);
    }
  }

  /** The turn-in-place animation of a `longLook`, whose `lookState` must already be set */
  startLookShuffle() {
    const s = this.lookState;
    this.npc.anim.moveClip = this.npc.clips.shuffle;
    // every other clip, not merely idle: a walk interrupted by this look — moving onto a
    // doable, say — otherwise keeps its full weight and strides underneath the shuffle
    for (const clip of Object.values(this.npc.clips)) {
      if (clip === this.moveClip) continue;
      this.mixer.existingAction(clip)?.fadeOut(0.15);
    }
    this.mixer.clipAction(this.moveClip).reset().fadeIn(0.15).play();
    // the feet keep up with the turn: a `minMs` slow enough to drag it out shuffles gently,
    // where the default rate still gives the 2 this always used
    const rate = s.duration > 0 ? Math.abs(s.totalDiff) / s.duration : lookShuffleRate;
    this.mixer.timeScale = THREE.MathUtils.clamp(rate / lookShuffleRate, minLookShuffleScale, maxLookShuffleScale);
  }

  /** Undoes `startLookShuffle`, and only that — a walk or run is left alone */
  stopLookShuffle() {
    if (this.moveClip !== this.npc.clips.shuffle) {
      return;
    }
    this.mixer.timeScale = 1;
    this.moveClip = this.npc.clips.walk;
    this.playIdleClip(0.15);
  }

  playIdleClip(duration = 0.1, idleClip = this.idleClip, force = false) {
    // fading all clips prevents e.g. sit from continuing
    for (const clip of Object.values(this.npc.clips)) {
      if (clip === idleClip) continue;
      this.mixer.existingAction(clip)?.fadeOut(duration);
    }

    if (!force && (this.mixer.existingAction(idleClip)?.getEffectiveWeight() ?? 0) > 0) {
      return; // avoid re-triggering the animation
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

    const forceIdleFadeIn = this.moving;

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

    this.playIdleClip(this.getFadeSecs(this.moveClip, this.idleClip), this.idleClip, forceIdleFadeIn);
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
      helper.groundPointToTuple(groundPoint),
    );

    const { last } = this.npc;
    // last.dst = groundPoint; // already set in `w.npc.move`
    last.dstGrId = this.w.e.findRoomContaining(groundPoint);
    last.blockingArea = -1;
    last.navNodeRef = -1;
    last.point = this.npc.point;
    last.moveTime = this.w.timer.getElapsedTime();
    // arrival radius is relative to this, else a short move starts arrived
    last.targetDistance = this.npc.distanceTo(groundPoint);

    this.npc.nodeCount = 0;
    this.stuckAccum = 0;
    this.arrive = arrive;

    if (this.moving) {
      return;
    }

    this.moving = true;
    this.npc.setBubbleHeight(bubbleHeightForClip(this.moveClip.name));
    this.npc.setLabelYShift(labelYShiftForClip(this.moveClip.name));

    const fade = this.getFadeSecs(this.idleClip, this.moveClip);
    this.mixer.existingAction(this.idleClip)?.fadeOut(fade);
    this.mixer.clipAction(this.moveClip).reset().fadeIn(fade).play();
  }

  getFadeSecs(src: THREE.AnimationClip, dst: THREE.AnimationClip) {
    const srcKey = src.name as AnimationClipKey;
    const dstKey = dst.name as AnimationClipKey;
    return fadeSecs[srcKey]?.[dstKey] ?? defaultFadeSecs;
  }

  /**
   * Has the move clip finished fading in?
   * Arriving before then would cut it off, looking jerky.
   */
  moveClipFadedIn() {
    return (this.mixer.existingAction(this.moveClip)?.getEffectiveWeight() ?? 0) >= 0.99;
  }

  syncAnimation(speed: number) {
    if (!this.moving) return;
    const moveAction = this.mixer.clipAction(this.moveClip);
    const moveClipKey = this.moveClip.name as AnimationClipKey;
    moveAction.timeScale = (moveClipKey === "run" ? 0.5 : 1) * Math.max(1 * (0.25 / npcScale), Math.max(speed, 0.5));
  }

  updateStuck(delta: number, worldSeconds: number): boolean {
    const { position, last } = this.npc;

    // grace whilst accelerating away from standstill
    if (worldSeconds - last.moveTime < npcConfig.time.stuckGrace) {
      return false;
    }

    const dx = position.x - last.point.x;
    const dz = position.z - last.point.y;
    const dist = Math.hypot(dx, dz);
    this.stuckAccum += dist < npcConfig.dist.stuckEpsilon ? delta : 0;
    last.point.x = position.x;
    last.point.y = position.z;

    return this.stuckAccum > npcConfig.time.stuckDuration;
  }
}

/**
 * How long a `longLook` takes to crossfade from its shuffle back to idle. It starts this
 * far before the turn ends, so both finish together rather than the idle following on.
 */
const lookIdleFadeMs = 300;

/**
 * The mean turn rate (radians per second) the shuffle clip is played at 1x for. `look` turns
 * at `2 * arc / duration` initially and eases to nothing, so the mean is half of that.
 */
const lookShuffleRate = Math.PI / 2;
const minLookShuffleScale = 0.4;
const maxLookShuffleScale = 3;

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
