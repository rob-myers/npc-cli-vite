import type { UseStateRef } from "@npc-cli/util";
import { deltaAngle } from "maath/misc";
import type { FindNearestPolyResult } from "navcat";
import { crowd as crowdApi } from "navcat/blocks";
import * as THREE from "three/webgpu";
import {
  defaultFadeSecs,
  defaultIdleAnimationClipKey,
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

/**
 * What an npc's skeleton is doing. One pose at a time, changed only by `setPose`; one `tick`;
 * and the transitions the world asks for. Inputs that vary per frame — `speed`, `face` — are
 * fields, written by whoever knows them and applied by the next `tick`
 */
export class NpcAnimation {
  npc: Npc;
  mixer = emptyMixer;

  /** The clip on show — a KEY, so it survives a hot-reload's new clip objects */
  pose: AnimationClipKey = defaultIdleAnimationClipKey;
  /** What `startIdle` returns to, and which gait `startMoving` shows */
  idleClip = emptyAnimationClip;
  moveClip = emptyAnimationClip;
  /** true iff moving via agent in navmesh */
  moving = false;
  /**
   * Arrive is `true` iff when npc moves it should slow down before final destination.
   * It can be set via `npc.move` or alternatively via `npc.preventArrive` during move.
   */
  arrive = true;
  /** How fast they are going, which paces the gait */
  speed = 0;

  /** The colour fade of `Npc.fadeIn`/`fadeOut`: `delta` per second towards `target`, `0` at rest */
  fadeState = { delta: 0, target: 1 };
  /** Facing: eased to `target` at `rate` (`0` holds) — unless a `timed` look is under way */
  face = {
    target: 0,
    rate: 0,
    timed: null as null | { start: number; diff: number; duration: number; elapsed: number; longLook: boolean },
  };
  /**
   * A breathing npc leant away from a walker — see `leanAway`: whom, the nearest at the last
   * sample; since when, held for `leanAwayMin`; and their facing as it began, turned about
   */
  leanState = { active: false, from: null as null | Npc, since: 0, baseY: 0 };

  constructor(npc: Npc) {
    this.npc = npc;
  }

  get w(): UseStateRef<import("./World").State> {
    return this.npc.w;
  }

  /** The ONLY way the clip on show changes: everything else fades out as `next` fades in */
  setPose(next: AnimationClipKey, { fade = fadeSecs[this.pose]?.[next] ?? defaultFadeSecs, force = false } = {}) {
    if (next === this.pose && force === false) return;
    const { clips } = this.npc;
    for (const clip of Object.values(clips)) {
      if (clip !== clips[next]) this.mixer.existingAction(clip)?.fadeOut(fade);
    }
    this.mixer.clipAction(clips[next]).reset().fadeIn(fade).play();
    if (this.pose === "shuffle") this.mixer.timeScale = 1; // see `lookAt`
    this.pose = next;
    this.npc.setBubbleHeight(bubbleHeightForClip(next));
    this.npc.setLabelYShift(labelYShiftForClip(next));
  }

  /** The ONLY per-frame work: the mixer, the colour fade, the gait's pace, and the facing */
  tick(delta: number) {
    this.mixer.update(delta);

    const { fadeState: f, face, leanState: lean } = this;
    const { colorScale, rotation } = this.npc;

    if (f.delta !== 0) {
      const step = colorScale.value + 0.5 * f.delta * delta;
      const next = f.delta < 0 ? Math.max(f.target, step) : Math.min(f.target, step);
      this.npc.labelVisible.value = next >= 1 ? 1 : 0;
      colorScale.value = next;
      if (next === f.target) {
        f.delta = 0;
        this.npc.material.needsUpdate = true;
        this.npc.resolve.fade("fade");
      }
    }

    if (this.moving === true) {
      const gait = this.moveClip.name === "run" ? 0.5 : 1;
      this.mixer.clipAction(this.moveClip).timeScale = gait * Math.max(0.25 / npcScale, this.speed, 0.5);
    }

    // leant away, they turn to the walker — no further than `leanTurnMax` from where they faced
    if (lean.active === true && lean.from !== null) {
      const { position } = this.npc;
      const toWalker = Math.atan2(lean.from.position.x - position.x, lean.from.position.z - position.z) + Math.PI;
      face.target = lean.baseY + THREE.MathUtils.clamp(deltaAngle(lean.baseY, toWalker), -leanTurnMax, leanTurnMax);
      face.rate = leanTurnScale;
    }

    if (face.timed !== null) {
      const t = face.timed;
      t.elapsed += delta;
      // begin crossfading back early, so the shuffle has become idle just as the turn lands.
      // Clamped, else a turn shorter than the fade would start it before it had begun
      if (t.longLook === true) {
        const idleFade = Math.min(lookIdleFadeMs / 1000, t.duration);
        if (t.elapsed >= t.duration - idleFade) {
          t.longLook = false;
          this.setPose(keyOf(this.idleClip), { fade: idleFade });
        }
      }
      if (t.elapsed >= t.duration) {
        rotation.y = t.start + t.diff;
        face.timed = null;
        face.rate = 0;
        this.npc.resolve.look("lookAt");
      } else {
        // ease-out: p(t) = 2t - t², velocity starts at v0 and falls to 0
        const p = t.elapsed / t.duration;
        rotation.y = t.start + t.diff * (2 * p - p * p);
      }
    } else if (face.rate > 0) {
      rotation.y += deltaAngle(rotation.y, face.target) * (1 - Math.exp(-5 * delta * face.rate));
    }
  }

  /**
   * Walk or run to `target` — `moveClip` says which — or, given `null`, merely show it: a mirror
   * npc's movement arrives over the network (see `use-world-net`)
   */
  startMoving(target: null | { groundPoint: JshCli.GroundPoint; result: FindNearestPolyResult }, arrive = true) {
    Object.assign(this.leanState, { active: false, from: null }); // the walk fades all else out

    if (target !== null) {
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
        target.result.nodeRef,
        helper.groundPointToTuple(target.groundPoint),
      );

      const { last } = this.npc;
      // last.dst = groundPoint; // already set in `w.npc.move`
      last.dstGrId = this.w.e.findRoomContaining(target.groundPoint);
      last.blockingArea = -1;
      last.point = this.npc.point;
      last.moveTime = this.w.timer.getElapsedTime();
      // arrival radius is relative to this, else a short move starts arrived
      last.targetDistance = this.npc.distanceTo(target.groundPoint);
      Object.assign(last, { stuckAccum: 0, nearest: Infinity, nearestAccum: 0 });
    }

    this.arrive = arrive;
    // a move interrupted by another keeps its gait on show, so the walk runs on into the new
    // leg — but a look or a spawn in between puts idle on, and it must be shown again or they slide
    if (this.moving === true && this.pose === keyOf(this.moveClip)) return;
    this.moving = true;
    this.setPose(keyOf(this.moveClip));
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

    this.face.rate = 0;
    this.setPose(keyOf(this.idleClip), { force: this.moving });
    this.moving = false;
  }

  /**
   * Turn to face `target` (radians) over a duration set by the arc — shuffling round for a long
   * one, whose feet keep up with the turn — and resolve `npc.resolve.look` on landing. See `Npc.look`
   */
  lookAt(target: number, minMs: number) {
    const start = this.npc.rotation.y;
    const diff = deltaAngle(start, target);
    const arc = Math.abs(diff);
    const longLook = arc > longLookAngle;
    // quadratic ease-out: T = 2|arc| / v0 so initial speed equals angularVelocity
    const duration = arc < 0.001 ? 0 : Math.max(minLookSecs, (2 * arc) / (2 * Math.PI), minMs / 1000);
    this.face.timed = { start, diff, duration, elapsed: 0, longLook };
    this.face.rate = 0;

    if (longLook === true) {
      this.setPose("shuffle");
      // a `minMs` slow enough to drag it out shuffles gently, where the default rate gives 2
      const rate = duration > 0 ? arc / duration : lookShuffleRate;
      this.mixer.timeScale = THREE.MathUtils.clamp(rate / lookShuffleRate, minLookShuffleScale, maxLookShuffleScale);
    } else if (this.pose === "shuffle") {
      this.setPose(keyOf(this.idleClip)); // a short look superseding a long one
    }
  }

  /** A breathing npc leans back (`idle-avoid`) whilst `walker` passes, and slumps back after none */
  leanAway(walker: null | Npc) {
    const s = this.leanState;
    const { clips, rotation } = this.npc;
    if (this.idleClip !== clips.breathe) return;
    s.from = walker ?? s.from; // kept through the hold
    const now = this.w.timer.getElapsedTime();
    if (walker !== null) {
      if (s.active === true) return;
      Object.assign(s, { active: true, since: now, baseY: rotation.y });
      this.setPose("idle-avoid");
    } else {
      if (s.active === false || now - s.since < npcConfig.time.leanAwayMin) return;
      s.active = false;
      this.face.rate = 0;
      this.setPose(keyOf(this.idleClip));
    }
  }
}

function keyOf(clip: THREE.AnimationClip) {
  return clip.name as AnimationClipKey;
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

/** Beyond this angle a look shuffles round rather than turning on the spot */
const longLookAngle = 30 * (Math.PI / 180);
/**
 * No look is quicker than this, however small the angle. The turn's peak rate is `2 * arc /
 * duration`, so a floor eases small turns off the 2π a bare `arc / π` would always give them —
 * and it meets that curve exactly at `arc = 0.3π`, so nothing jumps at the crossover.
 */
const minLookSecs = 0.3;
/**
 * How long a long look takes to crossfade from its shuffle back to idle. It starts this far
 * before the turn ends, so both finish together rather than the idle following on.
 */
const lookIdleFadeMs = 300;
/**
 * The mean turn rate (radians per second) the shuffle clip is played at 1x for. `look` turns
 * at `2 * arc / duration` initially and eases to nothing, so the mean is half of that.
 */
const lookShuffleRate = Math.PI / 2;
const minLookShuffleScale = 0.4;
const maxLookShuffleScale = 3;

/** How fast a leant-away npc turns to the walker, against a walker's own turn of `1` */
const leanTurnScale = 0.5;
/** …and how far, either way */
const leanTurnMax = (30 * Math.PI) / 180;
