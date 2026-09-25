import type { UseStateRef } from "@npc-cli/util";
import { deltaAngle } from "maath/misc";
import type { FindNearestPolyResult } from "navcat";
import { crowd as crowdApi } from "navcat/blocks";
import * as THREE from "three/webgpu";
import {
  agentConfig,
  defaultFadeSecs,
  defaultIdleAnimationClipKey,
  fadeSecs,
  npcScale,
  upperFadeSecs,
} from "../const.npc";
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
  /** Metres of the head's pivot above their feet in `pose` — see `w.npc.headYByPose` */
  headY = 0;
  /** What `startIdle` returns to, and the gait on show — which follows `speed`, see `syncGait` */
  idleClip = emptyAnimationClip;
  moveClip = emptyAnimationClip;
  /** The move's INTENT: they may run. Not which gait shows — that is `moveClip` */
  fast = false;
  /** The move's INTENT: they back away, facing whence they go — see `w.npc.move` */
  backwards = false;
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
  /** A clip over the upper body alone, eased in and out over the pose by `blend` — see `tickUpper` */
  upper = {
    key: null as null | AnimationClipKey,
    blend: 0,
    target: 0,
    /** Seconds into its clip */
    time: 0,
    /** Eased `0` to `1` from the last clip's pose to this one's — see `setUpper` */
    swap: 1,
    swapSecs: upperFadeSecs,
    group: null as null | THREE.Group,
    /** Each bone, the pose's rotation of it, and ours as last written — see `tickUpper` */
    bones: [] as { bone: THREE.Object3D; base: THREE.Quaternion; written: THREE.Quaternion; from: THREE.Quaternion }[],
  };
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
    this.headY = this.w.npc.headYByPose[next];
    this.npc.setBubbleHeight(bubbleHeightForClip(next));
    this.npc.setLabelYShift(labelYShiftForClip(next));
  }

  /** Ease `key` in over the upper body, or out with `null` — from another shown, in `swapSecs` */
  setUpper(key: null | AnimationClipKey, { swapSecs = upperFadeSecs } = {}) {
    const u = this.upper;
    if (key !== null && u.key !== null && key !== u.key && u.blend > 0) {
      u.bones.forEach((b) => b.from.copy(b.written)); // shown: ease over from where they are, in `swapSecs`
      Object.assign(u, { swap: 0, swapSecs });
    }
    if (key !== null) u.key = key;
    u.target = key === null ? 0 : 1;
  }

  /** The ONLY per-frame work: the mixers, the colour fade, the gait's pace, and the facing */
  tick(delta: number) {
    this.mixer.update(delta);
    this.tickUpper(delta);

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

  /** Slerp the upper body from the pose towards `upper.key`, by `blend` */
  tickUpper(delta: number) {
    const u = this.upper;
    const { group } = this.npc;
    u.blend = THREE.MathUtils.clamp(u.blend + (u.target === 1 ? delta : -delta) / upperFadeSecs, 0, 1);
    if (u.key === null || group === null) return;

    if (u.group !== group) {
      u.group = group; // a fresh group, or hmr
      u.bones = upperBodyBones.flatMap((name) => {
        const bone = group.getObjectByName(name);
        // `written` equals nothing, so the first tick reads the pose
        return bone === undefined
          ? []
          : [
              {
                bone,
                base: new THREE.Quaternion(),
                written: new THREE.Quaternion(Number.NaN),
                from: new THREE.Quaternion(),
              },
            ];
      });
    }

    // sampled, not mixed: a mixer only writes a bone whose value changed, so a still clip would leave ours
    const clip = this.npc.clips[u.key];
    u.time = (u.time + delta) % (clip.duration || 1);
    const tracks = upperTracksOf(clip);
    const t = u.blend * u.blend * (3 - 2 * u.blend);
    u.swap = Math.min(1, u.swap + delta / u.swapSecs);
    const s = u.swap * u.swap * (3 - 2 * u.swap);
    for (const { bone, base, written, from } of u.bones) {
      // the pose's, unless its mixer left ours there — as a still pose e.g. `lie` does
      if (bone.quaternion.equals(written) === false) base.copy(bone.quaternion);
      const track = tracks.get(bone.name);
      let q = track === undefined ? base : tmpQuat.fromArray(track.evaluate(u.time));
      if (s < 1) q = tmpSwap.slerpQuaternions(from, q, s);
      written.copy(bone.quaternion.slerpQuaternions(base, q, t));
    }
    if (u.blend === 0 && u.target === 0) u.key = null; // the pose's own again
  }

  /** Whilst `fast` the gait follows `speed` — with hysteresis, and a least time on each — else walk */
  syncGait(delta: number) {
    if (this.backwards === true) return; // one gait
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
      const { maxSpeed } = agentConfig;
      agent.maxSpeed = this.backwards === true ? maxSpeed.backwards : this.fast === true ? maxSpeed.run : maxSpeed.walk;
    }
    // after the turn, so a long one does not eat the stuck grace
    this.npc.last.moveTime = this.w.timer.getElapsedTime();

    this.arrive = arrive;
    // a move interrupted by another keeps its gait on show, so the walk runs on into the new
    // leg — but a look or a spawn in between puts idle on, and it must be shown again or they slide
    const clipKey = this.backwards === true ? "backwards" : "walk";
    if (this.moving === true && (this.backwards === true ? this.pose === clipKey : isGait(this.pose))) return;
    this.moving = true;
    this.moveClip = this.npc.clips[clipKey];
    this.gaitSecs = 0;
    this.setPose(clipKey);
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
  lookAt(target: number, minMs: number, rate = 1) {
    const start = this.npc.rotation.y;
    const diff = deltaAngle(start, target);
    const arc = Math.abs(diff);
    const longLook = arc > longLookAngle;
    // quadratic ease-out: T = 2|arc| / v0 so initial speed equals angularVelocity
    const duration = arc < 0.001 ? 0 : Math.max(Math.max(minLookSecs, (2 * arc) / (2 * Math.PI)) / rate, minMs / 1000);
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

/** Per bone of `upperBodyBones`, the rotation of `clip` at a time — cached per clip */
function upperTracksOf(clip: THREE.AnimationClip) {
  let tracks = upperTracks.get(clip);
  if (tracks === undefined) {
    const entries = upperBodyBones.flatMap((name) => {
      const track = clip.tracks.find((t) => t.name === `${name}.quaternion`);
      // set per track by its interpolation, but untyped
      const interpolant = (track as undefined | { createInterpolant(): THREE.Interpolant })?.createInterpolant();
      return interpolant === undefined ? [] : [[name, interpolant] as const];
    });
    upperTracks.set(clip, (tracks = new Map(entries)));
  }
  return tracks;
}

const upperTracks = new WeakMap<THREE.AnimationClip, Map<string, THREE.Interpolant>>();
/** The chest stays the pose's, so its breath and sway carry the arms */
const upperBodyBones = ["head", "rightarm", "rightforearm", "leftarm", "leftforearm"];
const tmpQuat = new THREE.Quaternion();
const tmpSwap = new THREE.Quaternion();

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
