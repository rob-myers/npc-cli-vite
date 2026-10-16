import type { UseStateRef } from "@npc-cli/util";
import { geomService } from "@npc-cli/util/geom-service";
import { deltaAngle } from "maath/misc";
import type { FindNearestPolyResult } from "navcat";
import { crowd as crowdApi } from "navcat/blocks";
import * as THREE from "three/webgpu";
import { type EyeFrame, type EyesKey, eyeFrames } from "../const.both";
import {
  agentConfig,
  breathConfig,
  defaultBreathTune,
  defaultFadeSecs,
  defaultIdleAnimationClipKey,
  eyesConfig,
  fadeSecs,
  gaitStride,
  headShakeConfig,
  hitConfig,
  lieAim,
  lieHeadMaxRad,
  lieRoll,
  npcScale,
  sitArmVia,
  sitTurn,
  stanceConfig,
  strafeEaseSecs,
  strafeSpeed,
  upperFadeSecs,
} from "../const.npc";
import { helper } from "../service/helper";
import type { AnimationClipKey } from "./NPCs";
import type { Npc } from "./npc";
import { letGo, newStance, takeStance, tickStance } from "./npc-stance";

const emptyMixer = new THREE.AnimationMixer({} as THREE.Object3D);
/** Stands in until the gltf loads, and for a clip it lacks */
export const emptyAnimationClip = new THREE.AnimationClip("empty-animation-clip");

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
  /** Whether `pose` has them stood, sat or lain: kept, as it is read every tick */
  posture = postureOf(defaultIdleAnimationClipKey);
  /** Metres of the head's pivot above their feet in `pose` — see `w.npc.headYByPose` */
  headY = 0;
  /** What `startIdle` returns to, and the gait on show — which follows `speed`, see `syncGait` */
  idleClip = emptyAnimationClip;
  moveClip = emptyAnimationClip;
  /** They run where they can, until told otherwise — by a move's `fast`, or the player's run button */
  hurry = false;
  /** They may run. Not which gait shows — that is `moveClip` */
  get fast() {
    return this.hurry === true && this.backwards === false && this.strafe === false;
  }
  /** The move's INTENT: they back away, facing whence they go — see `w.e.move` */
  backwards = false;
  /** The move's INTENT: they keep their facing, the gait blended by heading — see `syncStrafe` */
  strafe = false;
  /** The move left `strafe` to `face.aim`, so it follows the aim mid-move — see `setStrafe` */
  strafeFollowsAim = false;
  /** Is `walk` on show as the four directional gaits — see `setPose` */
  strafing = false;
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
  /** A clip over the RIGHT arm, eased in and out over the pose by `blend` — see `tickUpper` */
  upper = newUpper();
  /** …and one over the LEFT arm, so each hand has its own e.g. psi and a phaser: the head takes both, the right's last */
  upperLeft = newUpper();
  /** Their feet kept apart after a gait — see `npc-stance` */
  stance = newStance();
  /** The head, shared by both */
  upperHead = { entry: null as null | UpperBone };
  /** The head's turn to where it looks, eased towards it so it glides — see `aimHead` */
  headTurn = new THREE.Quaternion();
  /** World seconds at which they last rolled over in bed — see `rollOnto` */
  rolledAt = -Infinity;
  /**
   * A turn towards a point whilst sat, radians off their facing: eased to `target`, over stomach, chest and head.
   * `want` is the turn asked for, unclamped, and `aim` the phaser's — see `tickTurnAim`
   */
  turn = { target: 0, value: 0, bones: [] as UpperBone[], written: false, want: 0, aim: 0 };
  /** Lain, a look whilst no arm aims: the head turns to `at` by `weight`, eased towards `on` — see `lookLain` */
  lieLook = { on: false, weight: 0, at: new THREE.Vector3() };
  /** Their breathing: `amount` eases to `on`, and `phase` is in breaths — see `tickBreath` */
  breath = {
    on: false,
    amount: 0,
    phase: Math.random(),
    /** Multiplies their tune's rate, and its reach and glow — see `Spirit` */
    pace: 1,
    swell: 1,
    /** The air in their lungs and the effort of breathing in, `0` to `1`, then their tune's — read by `NpcBreath` */
    full: 0,
    drive: 0,
    glow: 0,
    reach: 0,
    /** The bone their ghost is carried by, once found */
    chest: null as null | THREE.Object3D,
    /** The resting pose's clip whose clock their breath has taken — see `breathClock` */
    held: null as null | THREE.AnimationAction,
  };
  /** In pain, or pacified: the clip shown instead of idle, seconds into it, and what follows it — see `setHurt` */
  hurt = null as null | { key: AnimationClipKey; secs: number; next: null | AnimationClipKey };
  /** Seconds into a shake of the head, else `null` — see `shakeHead` */
  headShake = null as null | number;
  /** Their eyes, ticked only whilst `busy`: blinking, or shifty — see `docs/skin-slices.md` */
  eyes = {
    busy: false,
    look: "open" as EyesKey,
    /** Seconds under this look */
    secs: 0,
    /** Blinks left, and seconds into this one */
    blinks: 0,
    blinkSecs: 0,
  };
  /** Facing: eased to `target` at `rate` (`0` holds) — unless a `turn` is under way, else `aim` sets both */
  face = {
    target: 0,
    rate: 0,
    /** Faced whilst set, moving or not: a point, tracked, or a world angle — `untilRest` if a look on the move set it */
    aim: null as null | { at: Geom.VectJson | number; rate: number; untilRest: boolean },
    /** A timed turn on the spot, setting off at `v0` and landing still — shuffling round if `longLook` — see `lookAt` */
    turn: null as null | {
      start: number;
      diff: number;
      duration: number;
      elapsed: number;
      longLook: boolean;
      v0: number;
    },
  };

  constructor(npc: Npc) {
    this.npc = npc;
  }

  get w(): UseStateRef<import("./World").State> {
    return this.npc.w;
  }

  /** The ONLY way the clip on show changes: everything else fades out as `next` fades in */
  setPose(next: AnimationClipKey, { fade = fadeSecs[this.pose]?.[next] ?? defaultFadeSecs, force = false } = {}) {
    if (next === this.pose && force === false) {
      return;
    }

    const shown = next === "walk" && this.strafe === true ? strafeClipKeys : [next];
    const { clips } = this.npc;

    for (const clip of Object.values(clips)) {
      if (shown.some((key) => clips[key] === clip)) {
        continue;
      }
      const hidden = this.mixer.existingAction(clip);
      if (hidden === null) {
        continue;
      }

      if (fade <= 0) {
        // a fade of no length weighs nothing until time moves on, which whilst paused it does not
        hidden.stop();
      } else {
        // fade out from current weight -- `fadeOut` starts from full weight
        hidden.weight = hidden.getEffectiveWeight();
        hidden.fadeOut(fade);
      }
    }
    const action = this.mixer.clipAction(clips[next]);
    // held on its last frame, so it does not wrap as it fades out
    const once = onceClips.has(next);
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = once;
    /** Already on show, e.g. walk as a strafe starts: restarting it would pop the feet and dip its weight */
    const kept = next === this.pose && action.isRunning();
    if (kept === false) (fade > 0 ? action.reset().fadeIn(fade) : action.reset()).play();
    action.weight = 1; // `syncStrafe` weighs the four, fading or not
    for (const key of shown.slice(1)) {
      const other = this.mixer.clipAction(clips[key]).reset().play();
      other.weight = 0;
      if (kept === false && fade > 0) other.fadeIn(fade); // else `syncStrafe` eases them in from nought
    }
    this.strafing = shown.length > 1;
    // walk <-> run: the phase carries over, else the feet pop
    const prev = this.mixer.existingAction(clips[this.pose]);
    if (kept === false && prev !== null && isGait(this.pose) && isGait(next)) {
      action.time = (prev.time / clips[this.pose].duration) * clips[next].duration;
    }
    if (this.pose === "shuffle") this.mixer.timeScale = 1; // see `lookAt`
    const { group } = this.npc;
    if (stanceConfig.on && group !== null && isStride(this.pose) && isStill(next))
      takeStance(this.stance, group, this.npc);
    this.pose = next;
    this.posture = postureOf(next);
    // sat or lain they are elsewhere, and a hold easing out would slide them on the seat
    if (this.stance.held === true && this.posture !== "stand") letGo(this.stance);
    this.headY = this.w.npc.headYByPose[next];
    this.npc.setBubbleHeight(bubbleHeightForClip(next));
    this.npc.setLabelYShift(labelYShiftForClip(next));
  }

  /**
   * Ease `key` in over an arm (and the head), or out with `null`, over `fadeSecs` — from another shown, in `swapSecs`.
   * `played`: start the clip at `0` and at full weight, for one whose first frame IS the pose e.g. `sit_reach`.
   * `past`: sat at a table (`isUnderTable`), the arm goes up and comes down by way of `sitArmVia`, past its edge.
   * `onHead`: its hand is at their head, and stays there as the head turns — see `tickTurn`
   */
  setUpper(
    key: null | AnimationClipKey,
    {
      swapSecs = upperFadeSecs,
      fadeSecs = upperFadeSecs,
      side = "right" as Side,
      played = false,
      past = false,
      onHead = false,
    } = {},
  ) {
    const u = this.upperOf(side);
    u.fadeSecs = fadeSecs;
    if (key !== null) Object.assign(u, { past, onHead });
    if (played === true) Object.assign(u, { time: 0, blend: 1 });
    if (key !== null && u.key !== null && key !== u.key && u.blend > 0) {
      // shown: ease over from where they are, in `swapSecs`
      for (const b of u.bones) b.from.copy(b.written);
      Object.assign(u, { swap: 0, swapSecs });
    }
    if (key !== null) u.key = key;
    u.target = key === null ? 0 : 1;
  }

  /** What they stand, sit or lie in at rest: the hurt clip whilst there is one */
  get restKey() {
    return this.hurt?.key ?? keyOf(this.idleClip);
  }

  /** The clip a hit on `part` plays, by whether they stand, sit or lie — `null` for none */
  hitClipFor(part: null | string): null | AnimationClipKey {
    const region = hitConfig.region[part ?? ""];
    return region === undefined ? null : hitConfig.clips[postureOf(keyOf(this.idleClip))][region];
  }

  /** Show `key` in place of idle: a pain clip once, a looped one e.g. pacified until `null` releases them */
  setHurt(key: null | AnimationClipKey) {
    /** The looped clip they are in, e.g. pacified or collapsed: a pain clip goes back to it */
    const held = this.hurt !== null && onceClips.has(this.hurt.key) === false ? this.hurt.key : null;
    const pacified = held !== null && isPacified(held);
    if (key !== null && pacified && (isPacified(key) || headClips.has(key))) return;
    // pacified, they stay so, whatever else hits them
    this.hurt = key === null ? null : { key, secs: 0, next: pacified ? held : (hitConfig.next[key] ?? held) };
    this.setPose(this.restKey, { force: key !== null });
    this.w.r3f?.invalidate();
  }

  tickHurt(delta: number) {
    const { hurt } = this;
    if (hurt === null || onceClips.has(hurt.key) === false) return;
    hurt.secs += delta;
    if (hurt.secs < this.npc.clips[hurt.key].duration) return;
    if (hurt.next === null) return this.setHurt(null);
    this.hurt = { key: hurt.next, secs: 0, next: null };
    this.setPose(hurt.next);
  }

  /** A fresh skeleton: the bones an upper clip, or a shake of the head, writes */
  setGroup(group: THREE.Group) {
    const bonesOf = (...names: string[]) => names.flatMap((name) => newUpperBone(group.getObjectByName(name)) ?? []);
    for (const side of ["left", "right"] as const) {
      const bones = bonesOf(`${side}arm`, `${side}forearm`);
      Object.assign(this.upperOf(side), { torso: bonesOf("stomach", "chest"), bones });
    }
    this.upperHead.entry = bonesOf("head")[0] ?? null;
    this.turn.bones = bonesOf("stomach", "chest", "head");
    this.breath.chest = null;
  }

  upperOf(side: Side) {
    return side === "right" ? this.upper : this.upperLeft;
  }

  /** The ONLY per-frame work: the mixers, the colour fade, the gait's pace, and the facing */
  tick(delta: number) {
    this.mixer.update(delta);
    // as the pose and its arms' clips left them, before either reads them again
    if (this.turn.written === true) {
      for (const { bone, base, written } of this.turn.bones)
        if (bone.quaternion.equals(written)) bone.quaternion.copy(base);
      this.turn.written = false;
    }
    this.tickLieLook(delta);
    this.tickUpper(delta);
    this.tickHeadShake(delta);
    this.tickTurn(delta);
    this.tickAimArm();
    this.tickHurt(delta);
    this.tickBreath(delta);
    if (this.eyes.busy === true) this.tickEyes(delta);
    const { stance } = this;
    if (stance.held === true && this.npc.group !== null)
      tickStance(stance, this.npc.group, isStill(this.pose), delta, this.npc);

    const { fadeState: f, face } = this;
    const { colorScale, rotation } = this.npc;

    const { aim } = face;
    if (aim && face.turn === null) {
      face.target = this.bearingOf(aim.at);
      face.rate = aim.rate;
    }
    const aiming = aim !== null;
    if (this.moving === true && this.strafeFollowsAim === true && aiming !== this.strafe) {
      this.setStrafe(aiming); // e.g. armed mid-move
    }

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
      if (this.strafing === true) this.syncStrafe(delta);
    }

    if (face.turn !== null) {
      const t = face.turn;
      t.elapsed += delta;
      // begin crossfading back early, so the shuffle has become idle just as the turn lands.
      // Clamped, else a turn shorter than the fade would start it before it had begun
      if (t.longLook === true) {
        const idleFade = Math.min(lookIdleFadeMs / 1000, t.duration);
        if (t.elapsed >= t.duration - idleFade) {
          t.longLook = false;
          this.setPose(this.restKey, { fade: idleFade });
        }
      }
      if (t.elapsed >= t.duration) {
        rotation.y = t.start + t.diff;
        face.turn = null;
        face.rate = 0;
        this.npc.resolve.look("lookAt");
      } else {
        // cubic Hermite, leaving at `v0` and landing still — a fresh look's `v0` makes it `2p - p²`
        const p = t.elapsed / t.duration;
        rotation.y = t.start + t.diff * p * p * (3 - 2 * p) + t.v0 * t.duration * p * (1 - p) * (1 - p);
      }
    } else if (face.rate > 0) {
      rotation.y += deltaAngle(rotation.y, face.target) * (1 - Math.exp(-5 * delta * face.rate));
    }
  }

  /** Breathe, or stop: eased either way, and nobody does until asked — see `docs/npc-breath.md` */
  setBreathing(on: boolean) {
    const { breath } = this;
    breath.on = on;
    // from where the pose's own breath has them, so nothing jumps
    const clock = on === true ? this.breathClock() : null;
    if (clock !== null) breath.phase = phaseOfClip(clock, this.breathTune.inhale);
    this.w.r3f?.invalidate();
  }

  /** The player's is the World's, set in their bubble: anyone else's the default. Read each tick, so not a copy */
  get breathTune() {
    return (this.npc.key === this.w.player?.key ? this.w.npc.breathTune : undefined) ?? defaultBreathTune;
  }

  /** The clip a resting pose breathes by, which a breath runs by its own clock instead */
  breathClock() {
    return breathClips.has(this.pose) ? this.mixer.existingAction(this.npc.clips[this.pose]) : null;
  }

  /** Works out the air in their lungs, for `NpcBreath` to draw, and has their body breathe with them */
  tickBreath(delta: number) {
    const { breath } = this;
    if (breath.on === false && breath.amount === 0) return; // nearly everyone, nearly always
    const tune = this.breathTune;
    breath.phase = (breath.phase + (delta * tune.rate * breath.pace) / 60) % 1;
    const step = delta / breathConfig.easeSecs;
    breath.amount = THREE.MathUtils.clamp(breath.amount + (breath.on ? step : -step), 0, 1);
    const full = lungVolume(breath.phase, tune.inhale);

    // their body moves by the pose's own clip, held at the moment it has them this full
    const clock = breath.on === true ? this.breathClock() : null;
    if (breath.held !== clock) {
      if (breath.held !== null) breath.held.timeScale = 1; // it carries on from where it was left
      breath.held = clock;
    }
    if (clock !== null) {
      clock.timeScale = 0;
      clock.time = clipTimeOf(full, breath.phase >= tune.inhale, clock.getClip().duration);
    }

    breath.full = full;
    // the effort of breathing in: none breathing out, which is recoil
    breath.drive = breath.phase < tune.inhale ? Math.sin((Math.PI * breath.phase) / tune.inhale) : 0;
    breath.glow = tune.glow * breath.swell;
    breath.reach = tune.reach * breath.swell;
    this.w.r3f?.invalidate();
  }

  /** Slerp each arm from the pose towards its clip, by `blend` — and the head towards the left's, then the right's over it */
  tickUpper(delta: number) {
    const [l, r] = [this.upperLeft, this.upper];
    this.tickUpperSide("left", delta);
    this.tickUpperSide("right", delta);
    const { entry } = this.upperHead;
    /** Lain, their look turns the head whilst no arm aims it */
    const look = r.aim === null && this.lieLook.weight > 0 ? this.lieLook : null;
    const turned = this.headTurn.w !== 1; // still easing back from a look
    if (entry === null || (l.key === null && r.key === null && look === null && turned === false)) return;
    const { bone, base, written } = entry;
    if (bone.quaternion.equals(written) === false) base.copy(bone.quaternion);
    bone.quaternion.copy(base);
    for (const u of [l, r]) if (u.key !== null && u.hasHead === true) bone.quaternion.slerp(u.head, u.eased);
    for (const u of [l, r]) if (u.key !== null) bone.quaternion.premultiply(u.level);
    written.copy(bone.quaternion);
    if (r.key !== null && r.aim !== null) this.aimHead(r.aim, (r.aim.head ?? r.aim.weight) * r.eased, delta);
    else if (look !== null) this.aimHead(look, look.weight * look.weight * (3 - 2 * look.weight), delta);
    else this.aimHead(null, 0, delta); // back to none
    for (const u of [l, r]) {
      if (u.blend !== 0 || u.target !== 0) continue;
      u.key = null; // the pose's own again
      u.aim = null;
    }
  }

  /** The way their head faces, as a rotation about the vertical. Their own facing whilst it looks nearly straight up or down */
  getLookY() {
    const head = this.upperHead.entry?.bone;
    if (head == null) return this.npc.rotation.y;
    /** As last drawn, so a frame behind: whoever asks eases it anyway, and it saves walking the skeleton */
    const e = head.matrixWorld.elements;
    // the head's forward, its `-z`, in the world
    const x = -e[8];
    const y = -e[9];
    const z = -e[10];
    const flat = x * x + z * z;
    return flat < lookFlatMin * (flat + y * y) ? this.npc.rotation.y : Math.atan2(-x, -z);
  }

  /** Lain, look towards `at` as a phaser aims: rolled to the pose that reaches it, the head lifting to it, and held there */
  lookLain(at: Geom.VectJson) {
    if (this.posture !== "lie") return;
    const pose = this.lieAimPoseFor(at);
    if (pose !== null && this.isRolling() === false) this.rollOnto(pose); // a roll cut short by the next jerks them
    this.lieLook.on = true;
    this.lieLook.at.set(at.x, this.npc.position.y + this.headY, at.y);
    this.w.r3f?.invalidate();
  }

  /** Eases `lieLook` in or out: out once they no longer lie */
  tickLieLook(delta: number) {
    const look = this.lieLook;
    if (this.posture !== "lie") look.on = false;
    if (look.on === false && look.weight === 0) return;
    look.weight = THREE.MathUtils.clamp(look.weight + (look.on ? delta : -delta) / upperFadeSecs, 0, 1);
    if (look.weight > 0 && look.weight < 1) this.w.r3f?.invalidate(); // still on its way
  }

  /** A roll in bed is still fading in */
  isRolling() {
    return this.w.timer.getElapsedTime() - this.rolledAt < lieRoll.secs;
  }

  /** Roll one lain onto `to`, a lie clip */
  rollOnto(to: AnimationClipKey) {
    const from = keyOf(this.idleClip);
    if (isLieKey(from) === false || to === from) return;
    this.rolledAt = this.w.timer.getElapsedTime();
    this.idleClip = this.npc.clips[to];
    if (this.pose === from) this.setPose(to);
    this.w.r3f?.invalidate();
  }

  /**
   * The bearing they aim along: their facing, sat, turned by `turn.aim`, or lain, `lieAim`'s `ahead` of it — `null` lain
   * in a clip it lacks
   */
  aimBearing() {
    const { rotation } = this.npc;
    if (this.posture === "sit") return rotation.y + this.turn.aim;
    if (this.posture !== "lie") return rotation.y;
    const lain = lieAim[this.pose];
    return lain === undefined ? null : rotation.y + lain.ahead;
  }

  /** They can aim at `at` as they are: sat, within `sitTurn`'s aim, lain, within their pose's `lieAim` */
  canAimAt(at: Geom.VectJson) {
    if (this.posture === "lie") return this.lieAimPoseFor(at) === this.pose;
    if (this.posture === "stand") return true;
    const off = deltaAngle(this.npc.rotation.y, this.bearingOf(at));
    return off >= sitTurn.aimFrom && off <= sitTurn.aimTo;
  }

  /** Lain, the bearing nearest `at` that their pose aims along — `null` in a clip `lieAim` lacks */
  lieAimBearing(at: Geom.VectJson) {
    const lain = lieAim[this.pose];
    if (lain === undefined) return null;
    const { y } = this.npc.rotation;
    return y + clampArc(deltaAngle(y, this.bearingOf(at)), lain.from, lain.to);
  }

  /** Lain, the pose they aim at `at` from: their own if it can, else one to roll onto — `null` if none can */
  lieAimPoseFor(at: Geom.VectJson): null | AnimationClipKey {
    const off = deltaAngle(this.npc.rotation.y, this.bearingOf(at));
    const fits = (key: AnimationClipKey) => {
      const lain = lieAim[key];
      return lain !== undefined && off >= lain.from && off <= lain.to;
    };
    return fits(this.pose) ? this.pose : (lieKeys.find(fits) ?? null);
  }

  /** Turn towards `at`, a point or bearing, whilst sat, as far as they can without turning round — `null` to face ahead again */
  turnTo(at: null | number | Geom.VectJson) {
    const off = at === null ? 0 : deltaAngle(this.npc.rotation.y, this.bearingOf(at));
    this.turn.want = off;
    const target = THREE.MathUtils.clamp(off, -sitTurn.maxRad, sitTurn.maxRad);
    if (target !== this.turn.target) this.w.r3f?.invalidate(); // else, at rest, no tick comes to ease it
    this.turn.target = target;
  }

  /**
   * Eases `turn.aim` to `turn.want` within `sitTurn`'s aim, round the front: never across behind them, which the arm
   * cannot do. Past either end it goes to the end nearer what they look at
   */
  tickTurnAim(delta: number) {
    const { turn } = this;
    const goal = clampArc(turn.want, sitTurn.aimFrom, sitTurn.aimTo);
    if (turn.aim === goal) return;
    turn.aim += (goal - turn.aim) * (1 - Math.exp(-sitTurn.rate * delta));
    if (Math.abs(turn.aim - goal) < 1e-3) turn.aim = goal;
    else this.w.r3f?.invalidate();
  }

  /** Mostly the head's, about the vertical: the torso takes a little, shared by its two bones */
  tickTurn(delta: number) {
    const { turn } = this;
    if (this.posture !== "sit") turn.target = turn.want = 0;
    this.tickTurnAim(delta);
    /** How far an arm aims them: the torso then turns with the gun, not with their look */
    const aiming = this.posture === "sit" && this.upper.aim !== null ? this.upper.eased : 0;
    /** Radians the torso turns with the gun past `aimTorsoFrom` to their left */
    const torsoAim = aiming * Math.max(0, turn.aim - sitTurn.aimTorsoFrom);
    if (turn.target === 0 && turn.value === 0 && torsoAim === 0) return; // nearly everyone, nearly always
    turn.value += (turn.target - turn.value) * (1 - Math.exp(-sitTurn.rate * delta));
    if (Math.abs(turn.value - turn.target) < 1e-3) turn.value = turn.target;
    else this.w.r3f?.invalidate(); // still on its way
    if (turn.value === 0 && torsoAim === 0) return;
    const head = this.upperHead.entry?.bone;
    /** Each hand at their head, where the head has it now: it goes there again once that has turned */
    for (const side of sides) {
      const u = this.upperOf(side);
      const forearm = u.bones[1]?.bone;
      held[side] = head != null && forearm !== undefined && u.key !== null && u.onHead === true;
      if (head == null || forearm === undefined || held[side] === false) continue;
      forearm.updateWorldMatrix(true, false);
      head.updateWorldMatrix(true, false);
      head.worldToLocal(forearm.localToWorld(tmpHeld[side].copy(forearm.position)));
    }
    /** The torso's turn: a share of their look's, giving way whilst an arm aims to the gun's far to their left */
    const torso = (1 - aiming) * sitTurn.body * turn.value + torsoAim;
    /** The head's turn on the torso: where they look, as far as the neck lets it from a torso turned with the gun */
    const neck = THREE.MathUtils.clamp(turn.value - torso, -sitTurn.maxRad, sitTurn.maxRad);
    /** Each bone's parent's world turn, carried down the chain (stomach, chest, head): one walk up the skeleton, not three */
    const chain = turn.bones[0]?.bone.parent?.getWorldQuaternion(tmpChain);
    if (chain == null) return; // no skeleton yet
    for (const { bone, base, written } of turn.bones) {
      base.copy(bone.quaternion);
      const angle = bone.name === "head" ? neck : torso / 2;
      const axis = tmpAxis.set(0, 1, 0).applyQuaternion(tmpQuat.copy(chain).invert());
      written.copy(bone.quaternion.premultiply(tmpQuat.setFromAxisAngle(axis, angle)));
      chain.multiply(bone.quaternion);
    }
    turn.written = true;
    for (const side of sides) {
      if (head == null || held[side] === false) continue;
      head.updateWorldMatrix(true, false);
      this.reachTo(side, head.localToWorld(tmpHeld[side]), this.upperOf(side).eased);
    }
  }

  /** Brings an arm's hand to `to`, a world point, by `weight`. The elbow stays to the side it is on */
  reachTo(side: Side, to: THREE.Vector3, weight: number) {
    const [upper, fore] = this.upperOf(side).bones;
    if (fore === undefined || upper.bone.parent === null) return;
    upper.bone.updateWorldMatrix(true, true);
    const shoulder = tmpShoulder.setFromMatrixPosition(upper.bone.matrixWorld);
    const reach = tmpWant.copy(to).sub(shoulder);
    const arm = tmpFrom.setFromMatrixPosition(fore.bone.matrixWorld).sub(shoulder);
    /** The forearm is as long as the upper arm */
    const tip = fore.bone.localToWorld(tmpTip.copy(fore.bone.position)).sub(shoulder);
    const [l1, l2] = [arm.length(), tip.distanceTo(arm)];
    const d = THREE.MathUtils.clamp(reach.length(), 1e-4, (l1 + l2) * 0.999);
    reach.normalize();
    // two bones to a point: the elbow lies `along` the reach and `out` from it, towards where it is now
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const out = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    const pole = tmpPole.copy(arm).addScaledVector(reach, -arm.dot(reach)).normalize();
    const elbow = tmpAlong.copy(reach).multiplyScalar(along).addScaledVector(pole, out).normalize();
    const swing = turnWithin(upper.bone.parent, arm.normalize(), elbow, Math.PI, weight);
    if (swing !== null) upper.written.copy(upper.bone.quaternion.premultiply(swing));

    fore.bone.updateWorldMatrix(true, false);
    const from = tmpFrom.setFromMatrixPosition(fore.bone.matrixWorld);
    const tipNow = fore.bone.localToWorld(tmpTip.copy(fore.bone.position)).sub(from).normalize();
    const want = reach.multiplyScalar(d).add(shoulder).sub(from).normalize();
    const bend = turnWithin(upper.bone, tipNow, want, Math.PI, weight);
    if (bend !== null) fore.written.copy(fore.bone.quaternion.premultiply(bend));
  }

  /** Their eyes take a look, whatever their pose */
  setEyes(look: EyesKey) {
    this.eyes.look = look;
    this.eyes.secs = 0;
    this.tickEyes(0);
  }

  /** They blink, over whatever look they have */
  blink(count = 1) {
    this.eyes.blinks = count;
    this.eyes.blinkSecs = 0;
    this.tickEyes(0);
  }

  /** Shows the frame their look, or a blink, is at */
  tickEyes(delta: number) {
    const { eyes } = this;
    const { blink, shifty } = eyesConfig;
    let frame: EyeFrame =
      eyes.look === "shifty"
        ? shifty.frames[Math.floor((eyes.secs += delta) / shifty.frameSecs) % shifty.frames.length]
        : eyes.look;

    if (eyes.blinks > 0) {
      const step = Math.floor((eyes.blinkSecs += delta) / blink.frameSecs);
      if (step < blink.frames.length) frame = blink.frames[step];
      else if (eyes.blinks === 1 || eyes.blinkSecs >= blink.frames.length * blink.frameSecs + blink.gapSecs) {
        eyes.blinks--;
        eyes.blinkSecs = 0;
      }
    }

    this.npc.eyesUniform.value = eyeFrames.indexOf(frame);
    eyes.busy = eyes.blinks > 0 || eyes.look === "shifty";
    this.w.r3f?.invalidate();
  }

  /** A "no": they shake their head, over whatever pose or upper clip has it */
  shakeHead() {
    this.headShake = 0;
    this.w.r3f?.invalidate();
  }

  tickHeadShake(delta: number) {
    const { entry } = this.upperHead;
    if (this.headShake === null || entry === null) return;
    const { bone, base, written } = entry;
    // with no upper clip, `tickUpper` has not put the head back to its pose
    if (this.upper.key === null && this.upperLeft.key === null) {
      if (bone.quaternion.equals(written)) bone.quaternion.copy(base);
      else base.copy(bone.quaternion);
    }
    const { secs, slowing, turns, rad } = headShakeConfig;
    const p = Math.min(1, (this.headShake += delta) / secs);
    const t = 1 - (1 - p) ** slowing;
    /** Nought at either end */
    const angle = rad * Math.sin(2 * Math.PI * turns * t) * Math.sin(Math.PI * t);
    written.copy(bone.quaternion.multiply(tmpQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, angle)));
    if (p === 1) this.headShake = null;
  }

  tickUpperSide(side: Side, delta: number) {
    const u = this.upperOf(side);
    if (u.key === null) return; // let go of: its blend is nought already
    const via = u.past === true && this.posture === "sit" && this.isUnderTable() ? sitArmVias[side] : null;
    const fadeSecs = u.fadeSecs * (via === null ? 1 : sitArmVia.slow);
    u.blend = THREE.MathUtils.clamp(u.blend + (u.target === 1 ? delta : -delta) / fadeSecs, 0, 1);
    if (this.npc.group === null) return;

    // sampled, not mixed: a mixer only writes a bone whose value changed, so a still clip would leave ours
    const clip = this.npc.clips[u.key];
    u.time = (u.time + delta) % (clip.duration || 1);
    const { tracks, torso, adds } = upperTracksOf(clip);
    const t = (u.eased = u.blend * u.blend * (3 - 2 * u.blend));
    const lean = adds === true ? this.turnUpperTorso(u, torso, t) : this.leanOfUpper(u, torso);
    u.swap = Math.min(1, u.swap + delta / u.swapSecs);
    const s = u.swap * u.swap * (3 - 2 * u.swap);
    for (let i = 0; i < u.bones.length; i++) {
      const { bone, base, written, from } = u.bones[i];
      // the pose's, unless its mixer left ours there — as a still pose e.g. `lie` does
      if (bone.quaternion.equals(written) === false) base.copy(bone.quaternion);
      const track = tracks.get(bone.name);
      let q = track === undefined ? base : tmpQuat.fromArray(track.evaluate(u.time));
      if (track !== undefined && bone.parent?.name === "chest") q.premultiply(lean);
      if (s < 1) q = tmpSwap.slerpQuaternions(from, q, s);
      if (via === null) {
        written.copy(bone.quaternion.slerpQuaternions(base, q, t));
        continue;
      }
      // towards the pose aside, and on to the clip's before it gets there: one move, with no stop
      const { there, onFrom } = sitArmVia;
      bone.quaternion.copy(base).slerp(via[i], smooth(u.blend / there));
      written.copy(bone.quaternion.slerp(q, smooth((u.blend - onFrom) / (1 - onFrom))));
    }
    const head = tracks.get("head");
    u.hasHead = head !== undefined;
    if (head !== undefined) u.head.fromArray(head.evaluate(u.time)).premultiply(lean);
  }

  /** Their seat is under a table: marked `meta.underTable` */
  isUnderTable() {
    const decorKey = this.w.npc.npcToDoable[this.npc.key];
    return decorKey != null && this.w.decor.byKey[decorKey]?.meta.underTable === true;
  }

  /**
   * An upper clip was drawn with its own torso lean, yet only its arms and head are applied. Returns the
   * turn from the pose's torso, as it is this frame, to the clip's: those keys are corrected by it
   */
  leanOfUpper(u: Upper, torso: THREE.Interpolant[]) {
    const lean = tmpLean.identity();
    u.level.identity();
    for (const { bone } of u.torso) lean.multiply(bone.quaternion);
    lean.invert();
    for (const interpolant of torso) lean.multiply(tmpQuat.fromArray(interpolant.evaluate(u.time)));
    return lean;
  }

  /**
   * For an `upperAddsTorso` clip: adds its stomach and chest turns to the pose's, eased by `t`, so the
   * torso really moves and still breathes. Sets `u.level`; returns no lean, the arms needing none
   */
  turnUpperTorso(u: Upper, torso: THREE.Interpolant[], t: number) {
    u.level.identity();
    u.torso.forEach(({ bone, base, written }, i) => {
      if (bone.quaternion.equals(written) === false) base.copy(bone.quaternion);
      const turn = tmpSwap.identity().slerp(tmpQuat.fromArray(torso[i].evaluate(u.time)), t);
      written.copy(bone.quaternion.copy(base).multiply(turn));
      // cancels both for the head: the stomach's turn as the chest sees it, then the chest's own
      if (i === 0) u.level.copy(turn).invert();
      else u.level.premultiply(tmpQuat.copy(base).invert()).multiply(base).premultiply(turn.invert());
    });
    return tmpLean.identity();
  }

  /** After `tickTurn`, so a sat turn of the torso is allowed for */
  tickAimArm() {
    const r = this.upper;
    if (r.key === null || r.aim === null) return;
    const weight = r.aim.weight * r.eased;
    if (weight > 0) this.aimArm(r.aim, weight);
  }

  /** Swing the right arm at the shoulder, by `weight` of the turn that lines its forearm up on `aim.at` */
  aimArm(aim: UpperAim, weight: number) {
    const [entry, forearm] = [this.upper.bones[0], this.upper.bones[1]?.bone];
    const arm = entry?.bone;
    if (arm?.parent == null || forearm === undefined) return;
    arm.parent.updateWorldMatrix(true, false);
    arm.updateWorldMatrix(false, true); // just written, and read at once
    const shoulder = tmpShoulder.setFromMatrixPosition(arm.matrixWorld);
    const along = tmpAlong.set(0, -1, 0).transformDirection(forearm.matrixWorld);
    const from = forearm.localToWorld(tmpFrom.copy(aim.from)).sub(shoulder);
    const want = tmpWant.copy(aim.at).sub(shoulder);
    // the point of the line of fire as far from the shoulder as the target is: turned onto it, the line runs through
    const b = from.dot(along);
    const reach = Math.sqrt(Math.max(0, b * b - from.lengthSq() + want.lengthSq())) - b;
    from.addScaledVector(along, reach).normalize();
    const turn = turnWithin(arm.parent, from, want.normalize(), aim.maxRad ?? upperAimMaxRad, weight);
    if (turn === null) return;
    entry.written.copy(arm.quaternion.premultiply(turn));
  }

  /** Eases the head's turn towards `headGoal`'s, else back to none, and applies it */
  aimHead(aim: null | { at: THREE.Vector3 }, weight: number, delta: number) {
    const { entry } = this.upperHead;
    const chest = entry?.bone.parent;
    if (entry === null || chest == null) return;
    const goal = this.headGoal(aim, weight, entry, chest);
    const { headTurn } = this;
    headTurn.slerp(goal, 1 - Math.exp(-headTurnRate * delta));
    if (headTurn.angleTo(goal) < 1e-3) headTurn.copy(goal);
    else this.w.r3f?.invalidate(); // still on its way
    entry.written.copy(entry.bone.quaternion.premultiply(headTurn));
  }

  /** The head's turn from their facing to look at `aim`, by `weight`. Lain, from where it faces, so it lifts a little */
  headGoal(aim: null | { at: THREE.Vector3 }, weight: number, entry: UpperBone, chest: THREE.Object3D) {
    if (aim === null || weight <= 0) return tmpHeadGoal.identity();
    chest.updateWorldMatrix(true, false);
    const lain = this.posture === "lie";
    const ry = this.npc.rotation.y;
    const from = lain
      ? tmpFrom.set(0, 0, -1).applyQuaternion(chest.getWorldQuaternion(tmpQuat).multiply(entry.bone.quaternion))
      : tmpFrom.set(-Math.sin(ry), 0, -Math.cos(ry));
    const neck = tmpShoulder.copy(entry.bone.position).applyMatrix4(chest.matrixWorld);
    const want = tmpWant.copy(aim.at).sub(neck);
    /** On their back, how far the look heads towards their feet: what heads the other way looks straight up instead */
    const along = this.pose === "lie" ? -want.x * Math.sin(ry) - want.z * Math.cos(ry) : 0;
    if (along < 0) want.set(want.x + Math.sin(ry) * along, want.y - along, want.z + Math.cos(ry) * along); // never tips back
    const maxRad = lain ? lieHeadMaxRad : headAimMaxRad;
    const turn = turnWithin(chest, from, want.normalize(), maxRad, weight);
    return turn === null ? tmpHeadGoal.identity() : tmpHeadGoal.copy(turn);
  }

  /** Whilst `fast` the gait follows `speed` — with hysteresis, and a least time on each — else walk */
  syncGait(delta: number) {
    if (this.backwards === true || this.strafe === true) return; // one gait
    const { runAbove, walkBelow, minSecs } = agentConfig.gait;
    this.gaitSecs += delta;
    const running = this.moveClip.name === "run";
    const next = this.fast === true && (running ? this.speed >= walkBelow : this.speed > runAbove);
    if (next === running || this.gaitSecs < minSecs || isGait(this.pose) === false) return;
    this.gaitSecs = 0;
    this.moveClip = this.npc.clips[next ? "run" : "walk"];
    this.setPose(keyOf(this.moveClip));
  }

  /** Start or stop strafing mid-move, as `face.aim` comes or goes: stopping eases out in `syncStrafe` */
  setStrafe(strafe: boolean) {
    this.strafe = strafe;
    this.backwards = false;
    if (this.npc.agent !== null) this.npc.agent.maxSpeed = this.maxSpeedFor();
    this.showGait();
  }

  /** Run, or stop running, mid-move: the gait follows their speed — see `syncGait` */
  setHurry(hurry: boolean) {
    this.hurry = hurry;
    const { agent } = this.npc;
    // `0` is pinned for the turn, and a strafe's is `syncStrafe`'s
    if (agent !== null && this.moving === true && this.strafe === false && agent.maxSpeed > 0)
      agent.maxSpeed = this.maxSpeedFor();
  }

  /** Weigh the directional gaits by heading relative to facing — the nearest two — and keep them in step, paced and sped by that way */
  syncStrafe(delta: number) {
    const { clips, agent, rotation } = this.npc;
    const actions = strafeClipKeys.map((key) => this.mixer.clipAction(clips[key]));
    const [vx, , vz] = agent?.velocity ?? [0, 0, 0];
    const ease = 1 - Math.exp(-delta / strafeEaseSecs); // alike for all four, so they still sum to 1
    if (this.strafe === false) {
      // let go mid-move: all to `walk`, which then shows alone
      actions.forEach((action, i) => void (action.weight += ((i === 0 ? 1 : 0) - action.weight) * ease));
    } else if (Math.hypot(vx, vz) >= 0.05) {
      // creeping, their velocity swings about: the last weights are kept
      const [sin, cos] = [Math.sin(rotation.y), Math.cos(rotation.y)];
      const heading = Math.atan2(vx * cos - vz * sin, -vx * sin - vz * cos); // `0` ahead, `π/2` to their right
      actions.forEach((action, i) => {
        const target = Math.max(0, 1 - Math.abs(deltaAngle(heading, (i * Math.PI) / 2)) / (Math.PI / 2));
        action.weight += (target - action.weight) * ease;
      });
    }
    const blend = (byKey: Record<(typeof strafeClipKeys)[number], number>) =>
      actions.reduce((sum, action, i) => sum + action.weight * byKey[strafeClipKeys[i]], 0);
    if (agent !== null && this.strafe === true) agent.maxSpeed = blend(strafeSpeed); // as fast as that way allows

    const [walk] = actions;
    const timeScale = walk.timeScale / (blend(gaitStride) || 1); // `tick`'s pace, per ground the blend covers
    const phase = walk.time / walk.getClip().duration;
    actions.forEach((action, i) => {
      action.timeScale = timeScale;
      if (i === 0) return;
      // `backwards` is `walk` reversed: a half cycle on, the same foot swings
      const offset = strafeClipKeys[i] === "backwards" ? 0.5 : 0;
      action.time = ((phase + offset) % 1) * action.getClip().duration;
    });
    if (this.strafe === false && walk.weight > 0.99) this.setPose("walk", { force: true });
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
    // last.dst = groundPoint; // already set in `w.e.move`
    last.dstGrId = this.w.findRoomContaining(target.groundPoint);
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
      agent.maxSpeed = this.maxSpeedFor();
    }
    // after the turn, so a long one does not eat the stuck grace
    this.npc.last.moveTime = this.w.timer.getElapsedTime();
    this.arrive = arrive;
    this.showGait();
  }

  /** The agent's top speed for the move's intent: a strafe's is then `syncStrafe`'s, by heading */
  maxSpeedFor() {
    const { maxSpeed } = agentConfig;
    if (this.strafe === true) return strafeSpeed.walk;
    return this.backwards === true ? maxSpeed.backwards : this.fast === true ? maxSpeed.run : maxSpeed.walk;
  }

  /** Show the move's gait unless on show: a walk runs on into a move's next leg, a strafe let go eases out in `syncStrafe` */
  showGait() {
    const clipKey = this.backwards === true ? "backwards" : "walk";
    // a look or a spawn in between puts idle on, and it must be shown again or they slide
    const shown = this.backwards === true ? this.pose === clipKey : isGait(this.pose);
    if (this.moving === true && shown === true && (this.strafe === false || this.strafing === true)) return;
    this.moving = true;
    this.moveClip = this.npc.clips[clipKey];
    this.gaitSecs = 0;
    this.setPose(clipKey, { force: this.strafing !== this.strafe });
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
    const { aim } = this.face;
    if (aim?.untilRest === true) this.face.aim = null;
    this.setPose(this.restKey, { force: this.moving });
    this.moving = false;
    // a look on the move they arrived before finishing: the rest of it on the spot
    if (aim?.untilRest === true) this.lookAt(this.bearingOf(aim.at), 0, aim.rate);
  }

  /** `face.aim.at` as a world angle, a point's from where they stand */
  bearingOf(at: Geom.VectJson | number) {
    return typeof at === "number"
      ? at
      : geomService.getThreeRotationY(at.y - this.npc.position.z, at.x - this.npc.position.x);
  }

  /** The turn's rate now, rad/s, `0` if none — a look superseding it sets off at it */
  getTurnRate() {
    const t = this.face.turn;
    if (t === null || t.duration === 0) return 0;
    const p = t.elapsed / t.duration;
    return (t.diff * 6 * p * (1 - p)) / t.duration + t.v0 * (1 - p) * (1 - 3 * p);
  }

  hasUpper(animKey: AnimationClipKey | null) {
    return this.upper.target === 1 && this.upper.key === animKey;
  }

  /**
   * Turn to face `target` (radians) over a duration set by the arc, shuffling round a long one, and resolve
   * `npc.resolve.look` on landing — setting off at `fromRate`, a superseded look's, rather than restarting
   */
  lookAt(target: number, minMs: number, rate = 1, fromRate = 0) {
    const start = this.npc.rotation.y;
    const diff = deltaAngle(start, target);
    const arc = Math.abs(diff);
    // a shuffle under way carries on, crossfading to idle as the turn lands
    const longLook = arc > longLookAngle || (fromRate !== 0 && this.pose === "shuffle");
    let duration = arc < 0.001 ? 0 : Math.max(Math.max(minLookSecs, (2 * arc) / (2 * Math.PI)) / rate, minMs / 1000);
    // fresh, a quadratic ease-out: it sets off at `2 * arc / duration`
    let v0 = duration === 0 ? 0 : (2 * diff) / duration;
    if (fromRate !== 0) {
      v0 = fromRate;
      // sooner, else it overshoots: at `3 * arc / |v0|` it is a cubic ease-out
      if (v0 * diff > 0 && Math.abs(v0) * duration > 3 * arc) duration = (3 * arc) / Math.abs(v0);
      duration = Math.max(duration, minStopSecs);
    }
    this.face.turn = { start, diff, duration, elapsed: 0, longLook, v0 };
    this.face.rate = 0;

    if (longLook === true) {
      this.setPose("shuffle");
      // a `minMs` slow enough to drag it out shuffles gently, where the default rate gives 2
      const rate = duration > 0 ? arc / duration : lookShuffleRate;
      this.mixer.timeScale = THREE.MathUtils.clamp(rate / lookShuffleRate, minLookShuffleScale, maxLookShuffleScale);
    } else if (this.pose === "shuffle") {
      this.setPose(this.restKey); // a short look superseding a long one
    }
  }
}

function isGait(key: AnimationClipKey) {
  return key === "walk" || key === "run";
}

/** A pose that leaves the feet apart as it ends */
function isStride(key: AnimationClipKey) {
  return isGait(key) || key === "backwards";
}

/** Whether a clip has them sat, lain or stood: `sit` and `lie`, and the hurt clips of each */
export function postureOf(key: AnimationClipKey) {
  return key === "sit" || key.startsWith("sit_pa") ? "sit" : key === "lie" || key.startsWith("lie_") ? "lie" : "stand";
}

/** The clips one lies at rest in, on their back then either side: not the hurt ones */
const lieKeys = ["lie", "lie_left", "lie_right"] as const satisfies AnimationClipKey[];
const isLieKey = (key: AnimationClipKey) => (lieKeys as readonly AnimationClipKey[]).includes(key);

/** `off` held from `from` to `to`, radians: outside, at whichever end is nearer round the circle */
function clampArc(off: number, from: number, to: number) {
  if (off >= from && off <= to) return off;
  return Math.abs(deltaAngle(off, from)) <= Math.abs(deltaAngle(off, to)) ? from : to;
}

const isPacified = (key: AnimationClipKey) => hitConfig.pacified.includes(key);
/** A head shot's clips: one on someone already pacified is not felt */
const headClips = new Set<AnimationClipKey>(Object.values(hitConfig.clips).map((byRegion) => byRegion.head));

/** Hit clips played once, then left */
const onceClips = new Set<AnimationClipKey>(
  Object.values(hitConfig.clips).flatMap((byRegion) => Object.values(byRegion).filter((key) => !isPacified(key))),
);

/** A pose stood still in, whose feet a stance may hold apart */
function isStill(key: AnimationClipKey) {
  return key === "idle" || key === "breathe";
}

/** Per bone of `upperBodyBones`, the rotation of `clip` at a time, and likewise its `torso`'s — cached per clip */
function upperTracksOf(clip: THREE.AnimationClip) {
  let cached = upperTracks.get(clip);
  if (cached === undefined) {
    const interpolantOf = (name: string) => {
      const track = clip.tracks.find((t) => t.name === `${name}.quaternion`);
      // set per track by its interpolation, but untyped
      return (track as undefined | { createInterpolant(): THREE.Interpolant })?.createInterpolant();
    };
    const tracks = new Map(
      upperBodyBones.flatMap((name) => {
        const interpolant = interpolantOf(name);
        return interpolant === undefined ? [] : [[name, interpolant] as const];
      }),
    );
    const torso = ["stomach", "chest"].flatMap((name) => interpolantOf(name) ?? []);
    upperTracks.set(clip, (cached = { tracks, torso, adds: upperAddsTorso.has(clip.name) }));
  }
  return cached;
}

/** Clockwise from ahead, a quarter turn apart — see `syncStrafe` */
const strafeClipKeys = ["walk", "strafe_right", "backwards", "strafe_left"] satisfies AnimationClipKey[];

const upperTracks = new WeakMap<
  THREE.AnimationClip,
  { tracks: Map<string, THREE.Interpolant>; torso: THREE.Interpolant[]; adds: boolean }
>();
/** Clips whose stomach and chest keys are ADDED to the pose's torso, moving it. Any other's only say how its arms lean */
const upperAddsTorso = new Set<string>(["sit_reach"]);
/** The chest stays the pose's, though its lean is the clip's — see `tickUpper` */
const upperBodyBones = ["head", "rightarm", "rightforearm", "leftarm", "leftforearm"];

type Side = "left" | "right";
const sides = ["left", "right"] as const;
/** Which hands are at their head, this tick — see `tickTurn` */
const held = { left: false, right: false };

/** Smoothstep, held outside `0` to `1` */
const smooth = (x: number) => THREE.MathUtils.smoothstep(x, 0, 1);
/** `sitArmVia` as an arm's two bones have it: mirrored for the right */
const sitArmVias = Object.fromEntries(
  sides.map((side) => [
    side,
    [sitArmVia.arm, sitArmVia.forearm].map(([x, y, z]) => {
      const sign = side === "left" ? 1 : -1;
      const [rx, ry, rz] = [x, y * sign, z * sign].map(THREE.MathUtils.degToRad);
      return new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, "ZYX"));
    }),
  ]),
) as Record<Side, THREE.Quaternion[]>;
/** A bone, the pose's rotation of it, ours as last written, and where a swap set out from — see `tickUpper` */
type UpperBone = { bone: THREE.Object3D; base: THREE.Quaternion; written: THREE.Quaternion; from: THREE.Quaternion };

/** `written` equals nothing, so the first tick reads the pose */
const newUpperBone = (bone?: THREE.Object3D): null | UpperBone =>
  bone === undefined
    ? null
    : { bone, base: new THREE.Quaternion(), written: new THREE.Quaternion(Number.NaN), from: new THREE.Quaternion() };

type Upper = ReturnType<typeof newUpper>;
const newUpper = () => ({
  key: null as null | AnimationClipKey,
  blend: 0,
  target: 0,
  /** Seconds it eases in or out over, as `setUpper` last said */
  fadeSecs: upperFadeSecs,
  /** Seconds into its clip */
  time: 0,
  /** Sat at a table, it goes up and down by way of `sitArmVia` */
  past: false,
  /** Its hand is at their head */
  onHead: false,
  /** Eased `0` to `1` from the last clip's pose to this one's — see `setUpper` */
  swap: 1,
  swapSecs: upperFadeSecs,
  /** Turns the right arm so its forearm, seen from `from` in its own frame, points `at` a world point — and the head to look there */
  aim: null as null | UpperAim,
  /** The pose's stomach and chest: read for the lean, or written by an `upperAddsTorso` clip */
  torso: [] as UpperBone[],
  /** Its arm, then its forearm */
  bones: [] as UpperBone[],
  /** `blend`, eased */
  eased: 0,
  /** Cancels an `upperAddsTorso` clip's torso turns for the head, so it stays level */
  level: new THREE.Quaternion(),
  /** Where its clip has the head, if it keys it */
  head: new THREE.Quaternion(),
  hasHead: false,
});
/** The least of a head's forward that must be level, squared, for it to say which way they look: under it they look up or down */
const lookFlatMin = 0.25;
/** The most an `UpperAim` swings the arms off their pose */
const upperAimMaxRad = Math.PI / 5;
/** …and the most it turns the head off their facing */
const headAimMaxRad = Math.PI / 4;
/** How fast the head's turn eases to where it should look, per second */
const headTurnRate = 10;
const tmpHeadGoal = new THREE.Quaternion();
const tmpChain = new THREE.Quaternion();
const tmpQuat = new THREE.Quaternion();
const tmpSwap = new THREE.Quaternion();
const tmpLean = new THREE.Quaternion();
const tmpShoulder = new THREE.Vector3();
const tmpAlong = new THREE.Vector3();
const tmpWant = new THREE.Vector3();
const tmpFrom = new THREE.Vector3();
const tmpAxis = new THREE.Vector3();
const tmpTip = new THREE.Vector3();
const tmpPole = new THREE.Vector3();
const tmpHeld = { left: new THREE.Vector3(), right: new THREE.Vector3() };

/**
 * The air in their lungs, `0` to `1`, at `phase` of a breath. In by muscle, a smooth rise.
 * Out by recoil, critically damped: quick at first, then all but still until the next
 */
function lungVolume(phase: number, inhale: number) {
  if (phase < inhale) return 0.5 - 0.5 * Math.cos((Math.PI * phase) / inhale);
  const atEnd = airLeft(1);
  return (airLeft((phase - inhale) / (1 - inhale)) - atEnd) / (1 - atEnd);
}

/** The share of a breath still in them `x` of the way through breathing out, before it is fitted to end on nought */
function airLeft(x: number) {
  const k = breathConfig.recoil;
  return (1 + k * x) * Math.exp(-k * x);
}

/** Poses at rest whose clip is one breath: empty at `0` and full halfway, whatever its length */
const breathClips = new Set<AnimationClipKey>(["idle", "breathe", "sit", "lie", "lie_left", "lie_right"]);

/** Seconds into such a clip at which it has them `volume` full */
function clipTimeOf(volume: number, exhaling: boolean, duration: number) {
  const up = ((duration / 2) * Math.acos(1 - 2 * THREE.MathUtils.clamp(volume, 0, 1))) / Math.PI;
  return exhaling === true ? duration - up : up;
}

/** The phase of a breath at which their lungs are as full as such a clip has them now */
function phaseOfClip(action: THREE.AnimationAction, inhale: number) {
  const { duration } = action.getClip();
  const time = ((action.time % duration) + duration) % duration;
  const volume = 0.5 - 0.5 * Math.cos((2 * Math.PI * time) / duration);
  if (time < duration / 2) return (inhale * Math.acos(1 - 2 * volume)) / Math.PI;
  // breathing out only ever falls, so it is halved onto
  let [from, to] = [inhale, 1];
  for (let i = 0; i < 20; i++) {
    const mid = (from + to) / 2;
    if (lungVolume(mid, inhale) > volume) from = mid;
    else to = mid;
  }
  return from;
}

/** `weight` of the turn from `from` onto `want`, world and unit, `maxRad` at most: about `parent`'s child, so in its frame */
function turnWithin(parent: THREE.Object3D, from: THREE.Vector3, want: THREE.Vector3, maxRad: number, weight: number) {
  const angle = from.angleTo(want);
  if (angle < 1e-4) return null;
  const axis = tmpAxis.crossVectors(from, want).normalize();
  axis.applyQuaternion(parent.getWorldQuaternion(tmpQuat).invert());
  return tmpQuat.setFromAxisAngle(axis, Math.min(angle, maxRad) * weight);
}

/** `weight` `0` to `1` eases it in: `at` and `from` are read each tick, so may be moved */
export type UpperAim = {
  at: THREE.Vector3;
  from: THREE.Vector3;
  weight: number;
  /** How far the head turns to look, where that is not as far as the arm swings (`weight`) */
  head?: number;
  /** The most it swings the arm off its pose, `upperAimMaxRad` unless given */
  maxRad?: number;
};

function keyOf(clip: THREE.AnimationClip) {
  return clip.name as AnimationClipKey;
}

function bubbleHeightForClip(clipName: AnimationClipKey): number {
  const posture = postureOf(clipName);
  if (posture === "sit" || clipName === "collapsed") return 1.4; // collapsed, sat on the floor
  if (posture === "lie") return 0.9;
  return 2;
}

/** The highest a label is lifted, standing — see `boundAnyPose` */
export const labelYShiftMax = 2.2;

function labelYShiftForClip(clipName: AnimationClipKey): number {
  const posture = postureOf(clipName);
  if (posture === "sit" || clipName === "collapsed") return 1.6; // collapsed, sat on the floor
  if (posture === "lie") return 0.75;
  return labelYShiftMax;
}

/** Beyond this angle a look shuffles round rather than turning on the spot */
const longLookAngle = 30 * (Math.PI / 180);
/**
 * No look is quicker than this, however small the angle. The turn's peak rate is `2 * arc /
 * duration`, so a floor eases small turns off the 2π a bare `arc / π` would always give them —
 * and it meets that curve exactly at `arc = 0.3π`, so nothing jumps at the crossover.
 */
const minLookSecs = 0.3;
/** The least a superseding look takes, so a turn under way is slowed rather than stopped dead */
const minStopSecs = 0.15;
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
