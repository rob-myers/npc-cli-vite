import type { UseStateRef } from "@npc-cli/util";
import { deltaAngle } from "maath/misc";
import type { FindNearestPolyResult } from "navcat";
import { crowd as crowdApi } from "navcat/blocks";
import * as THREE from "three/webgpu";
import { agentConfig, defaultFadeSecs, defaultIdleAnimationClipKey, fadeSecs, npcScale } from "../const.npc";
import { helper } from "../service/helper";
import { emptyAnimationClip } from "../service/three-animation";
import type { AnimationClipKey } from "./NPCs";
import type { Npc } from "./npc";

const emptyMixer = new THREE.AnimationMixer({} as THREE.Object3D);

/**
 * What an npc's skeleton is doing. One pose at a time, changed only by `setPose`; one `tick`;
 * and the transitions the world asks for. Inputs that vary per frame — `speed`, `face` — are
 * fields, written by whoever knows them (`onTick`, the net mirror, a jsh demo) and applied by
 * the next `tick`
 */
export class NpcAnimation {
  npc: Npc;
  mixer = emptyMixer;

  /** The clip on show — a KEY, so it survives a hot-reload's new clip objects */
  pose: AnimationClipKey = defaultIdleAnimationClipKey;
  /** What `startIdle` returns to, and the gait on show — which follows `speed`, see `syncGait` */
  idleClip = emptyAnimationClip;
  moveClip = emptyAnimationClip;
  /** The move's INTENT: they may run. Not which gait shows — that is `moveClip` */
  fast = false;
  /** Seconds the gait on show has been on, against `agentConfig.gait.minSecs` */
  gaitSecs = 0;
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
    const action = this.mixer.clipAction(clips[next]).reset().fadeIn(fade).play();
    // walk <-> run: the phase carries over, else the feet pop
    const prev = this.mixer.existingAction(clips[this.pose]);
    if (prev !== null && isGait(this.pose) && isGait(next)) {
      action.time = (prev.time / clips[this.pose].duration) * clips[next].duration;
    }
    if (this.pose === "shuffle") this.mixer.timeScale = 1; // see `lookAt`
    this.pose = next;
    this.npc.setBubbleHeight(bubbleHeightForClip(next));
    this.npc.setLabelYShift(labelYShiftForClip(next));
  }

  /** The ONLY per-frame work: the mixer, the colour fade, the gait's pace, and the facing */
  tick(delta: number) {
    this.mixer.update(delta);

    const { fadeState: f, face } = this;
    const { colorScale, rotation } = this.npc;

    if (f.delta !== 0) {
      const step = colorScale.value + 0.5 * f.delta * delta;
      const next = f.delta < 0 ? Math.max(f.target, step) : Math.min(f.target, step);
      colorScale.value = next;
      if (next === f.target) {
        f.delta = 0;
        this.npc.material.needsUpdate = true;
        this.npc.resolve.fade("fade");
      }
    }

    if (this.moving === true) {
      this.syncGait(delta);
      const gait = this.moveClip.name === "run" ? 0.5 : 1;
      this.mixer.clipAction(this.moveClip).timeScale = gait * Math.max(0.25 / npcScale, this.speed, 0.5);
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

  /** Whilst `fast` the gait follows `speed` — with hysteresis, and a least time on each — else walk */
  syncGait(delta: number) {
    const { runAbove, walkBelow, minSecs } = agentConfig.gait;
    this.gaitSecs += delta;
    const running = this.moveClip.name === "run";
    const next = this.fast === true && (running ? this.speed >= walkBelow : this.speed > runAbove);
    if (next === running || this.gaitSecs < minSecs || isGait(this.pose) === false) return;
    this.gaitSecs = 0;
    this.moveClip = this.npc.clips[next ? "run" : "walk"];
    this.setPose(keyOf(this.moveClip));
  }

  /**
   * Ask the crowd for a path to `target`, pinned at rest. One crowd tick later its corners say
   * where the first leg heads, which `w.npc.turnBeforeMoving` turns to before `startMoving`
   * releases them — and the corridor is kept, so nothing is pathed twice
   */
  aimAt(target: { groundPoint: JshCli.GroundPoint; result: FindNearestPolyResult }) {
    const agent = this.npc.agent;
    if (!agent) {
      throw Error(`cannot move without agent: ${this.npc.key}`);
    }
    // whilst walking, doors should block npcs
    agent.queryFilter = this.npc.queryFilter;
    agent.separationWeight = agentConfig.separationWeight.walk;
    agent.maxSpeed = 0; // `startMoving` releases them

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
    // arrival radius is relative to this, else a short move starts arrived
    last.targetDistance = this.npc.distanceTo(target.groundPoint);
    Object.assign(last, { stuckAccum: 0, nearest: Infinity, nearestAccum: 0 });
  }

  /**
   * Show the gait — walk, from rest: `syncGait` breaks into a run — and release the agent `aimAt` pinned. A mirror npc
   * has no agent: its movement arrives over the network (see `use-world-net`)
   */
  startMoving(arrive = true) {
    const agent = this.npc.agent;
    if (agent !== null) {
      // both on release: `onTick` drops the acceleration of anyone at rest, the pinned included
      agent.maxAcceleration = agentConfig.maxAcceleration.walk;
      agent.maxSpeed = this.fast === true ? agentConfig.maxSpeed.run : agentConfig.maxSpeed.walk;
    }
    // after the turn, so a long one does not eat the stuck grace
    this.npc.last.moveTime = this.w.timer.getElapsedTime();

    this.arrive = arrive;
    // a move interrupted by another keeps its gait on show, so the walk runs on into the new
    // leg — but a look or a spawn in between puts idle on, and it must be shown again or they slide
    if (this.moving === true && isGait(this.pose)) return;
    this.moving = true;
    this.moveClip = this.npc.clips.walk;
    this.gaitSecs = 0;
    this.setPose("walk");
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
      agent.separationWeight = agentConfig.separationWeight.idle;
      agent.maxAcceleration = agentConfig.maxAcceleration.idle;
      agent.maxSpeed = agentConfig.maxSpeed.idle;
      const [vx, , vz] = agent.velocity;

      // pin ahead by stopping distance v²/2a so agent decelerates without reversing
      const speed = Math.hypot(vx, vz);
      const pinAhead = speed ** 2 / (2 * agentConfig.maxAcceleration.idle);
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
}

function isGait(key: AnimationClipKey) {
  return key === "walk" || key === "run";
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
 * The mean turn rate (rad/s) the shuffle clip is played at 1x for. `duration` floors at `arc / π`,
 * so `arc / duration` never exceeds π — at π the clip never runs FASTER than its own pace
 */
const lookShuffleRate = Math.PI;
const minLookShuffleScale = 0.4;
const maxLookShuffleScale = 1;
