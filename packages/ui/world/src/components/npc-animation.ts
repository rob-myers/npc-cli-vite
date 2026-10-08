import type { UseStateRef } from "@npc-cli/util";
import { geomService } from "@npc-cli/util/geom-service";
import { deltaAngle } from "maath/misc";
import type { FindNearestPolyResult } from "navcat";
import { crowd as crowdApi } from "navcat/blocks";
import * as THREE from "three/webgpu";
import {
  agentConfig,
  defaultFadeSecs,
  defaultIdleAnimationClipKey,
  fadeSecs,
  gaitStride,
  headShakeConfig,
  npcScale,
  stanceConfig,
  strafeEaseSecs,
  strafeSpeed,
  upperFadeSecs,
} from "../const.npc";
import { helper } from "../service/helper";
import type { AnimationClipKey } from "./NPCs";
import type { Npc } from "./npc";
import { newStance, takeStance, tickStance } from "./npc-stance";

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
  /** Metres of the head's pivot above their feet in `pose` — see `w.npc.headYByPose` */
  headY = 0;
  /** What `startIdle` returns to, and the gait on show — which follows `speed`, see `syncGait` */
  idleClip = emptyAnimationClip;
  moveClip = emptyAnimationClip;
  /** They run where they can, until told otherwise — by a move's `fast`, or the player's `f` */
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
  /** Seconds into a shake of the head, else `null` — see `shakeHead` */
  headShake = null as null | number;
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
    if (next === this.pose && force === false) return;
    const { clips } = this.npc;
    const shown = next === "walk" && this.strafe === true ? strafeClipKeys : [next];
    for (const clip of Object.values(clips)) {
      if (shown.some((key) => clips[key] === clip)) continue;
      const hidden = this.mixer.existingAction(clip);
      // a fade of no length weighs nothing until time moves on, which whilst paused it does not
      if (fade > 0) hidden?.fadeOut(fade);
      else hidden?.stop();
    }
    const action = this.mixer.clipAction(clips[next]);
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
    this.headY = this.w.npc.headYByPose[next];
    this.npc.setBubbleHeight(bubbleHeightForClip(next));
    this.npc.setLabelYShift(labelYShiftForClip(next));
  }

  /**
   * Ease `key` in over an arm (and the head), or out with `null` — from another shown, in `swapSecs`.
   * `played`: start the clip at `0` and at full weight, for one whose first frame IS the pose e.g. `sit_reach`
   */
  setUpper(key: null | AnimationClipKey, { swapSecs = upperFadeSecs, side = "right" as Side, played = false } = {}) {
    const u = this.upperOf(side);
    if (played === true) Object.assign(u, { time: 0, blend: 1 });
    if (key !== null && u.key !== null && key !== u.key && u.blend > 0) {
      // shown: ease over from where they are, in `swapSecs`
      for (const b of u.bones) b.from.copy(b.written);
      Object.assign(u, { swap: 0, swapSecs });
    }
    if (key !== null) u.key = key;
    u.target = key === null ? 0 : 1;
  }

  /** A fresh skeleton: the bones an upper clip, or a shake of the head, writes */
  setGroup(group: THREE.Group) {
    const bonesOf = (...names: string[]) => names.flatMap((name) => newUpperBone(group.getObjectByName(name)) ?? []);
    for (const side of ["left", "right"] as const) {
      const bones = bonesOf(`${side}arm`, `${side}forearm`);
      Object.assign(this.upperOf(side), { torso: bonesOf("stomach", "chest"), bones });
    }
    this.upperHead.entry = bonesOf("head")[0] ?? null;
  }

  upperOf(side: Side) {
    return side === "right" ? this.upper : this.upperLeft;
  }

  /** The ONLY per-frame work: the mixers, the colour fade, the gait's pace, and the facing */
  tick(delta: number) {
    this.mixer.update(delta);
    this.tickUpper(delta);
    this.tickHeadShake(delta);
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
          this.setPose(keyOf(this.idleClip), { fade: idleFade });
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

  /** Slerp each arm from the pose towards its clip, by `blend` — and the head towards the left's, then the right's over it */
  tickUpper(delta: number) {
    const [l, r] = [this.upperLeft, this.upper];
    this.tickUpperSide("left", delta);
    this.tickUpperSide("right", delta);
    const { entry } = this.upperHead;
    if (entry === null || (l.key === null && r.key === null)) return;
    const { bone, base, written } = entry;
    if (bone.quaternion.equals(written) === false) base.copy(bone.quaternion);
    bone.quaternion.copy(base);
    for (const u of [l, r]) if (u.key !== null && u.hasHead === true) bone.quaternion.slerp(u.head, u.eased);
    for (const u of [l, r]) if (u.key !== null) bone.quaternion.premultiply(u.level);
    written.copy(bone.quaternion);
    if (r.key !== null && r.aim !== null) {
      const [arm, head] = [r.aim.weight * r.eased, (r.aim.head ?? r.aim.weight) * r.eased];
      if (arm > 0) this.aimArm(r.aim, arm);
      if (head > 0) this.aimHead(r.aim, head);
    }
    for (const u of [l, r]) {
      if (u.blend !== 0 || u.target !== 0) continue;
      u.key = null; // the pose's own again
      u.aim = null;
    }
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
    u.blend = THREE.MathUtils.clamp(u.blend + (u.target === 1 ? delta : -delta) / upperFadeSecs, 0, 1);
    if (u.key === null || this.npc.group === null) return;

    // sampled, not mixed: a mixer only writes a bone whose value changed, so a still clip would leave ours
    const clip = this.npc.clips[u.key];
    u.time = (u.time + delta) % (clip.duration || 1);
    const { tracks, torso, adds } = upperTracksOf(clip);
    const t = (u.eased = u.blend * u.blend * (3 - 2 * u.blend));
    const lean = adds === true ? this.turnUpperTorso(u, torso, t) : this.leanOfUpper(u, torso);
    u.swap = Math.min(1, u.swap + delta / u.swapSecs);
    const s = u.swap * u.swap * (3 - 2 * u.swap);
    for (const { bone, base, written, from } of u.bones) {
      // the pose's, unless its mixer left ours there — as a still pose e.g. `lie` does
      if (bone.quaternion.equals(written) === false) base.copy(bone.quaternion);
      const track = tracks.get(bone.name);
      let q = track === undefined ? base : tmpQuat.fromArray(track.evaluate(u.time));
      if (track !== undefined && bone.parent?.name === "chest") q.premultiply(lean);
      if (s < 1) q = tmpSwap.slerpQuaternions(from, q, s);
      written.copy(bone.quaternion.slerpQuaternions(base, q, t));
    }
    const head = tracks.get("head");
    u.hasHead = head !== undefined;
    if (head !== undefined) u.head.fromArray(head.evaluate(u.time)).premultiply(lean);
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

  /** Turn the head from their facing to look where the arms aim */
  aimHead(aim: UpperAim, weight: number) {
    const { entry } = this.upperHead;
    const chest = entry?.bone.parent;
    if (entry === null || chest == null) return;
    const ry = this.npc.rotation.y;
    const from = tmpFrom.set(-Math.sin(ry), 0, -Math.cos(ry));
    chest.updateWorldMatrix(true, false);
    const neck = tmpShoulder.copy(entry.bone.position).applyMatrix4(chest.matrixWorld);
    const turn = turnWithin(chest, from, tmpWant.copy(aim.at).sub(neck).normalize(), headAimMaxRad, weight);
    if (turn !== null) entry.written.copy(entry.bone.quaternion.premultiply(turn));
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
    this.setPose(keyOf(this.idleClip), { force: this.moving });
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
      this.setPose(keyOf(this.idleClip)); // a short look superseding a long one
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
  /** Seconds into its clip */
  time: 0,
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
/** The most an `UpperAim` swings the arms off their pose */
const upperAimMaxRad = Math.PI / 5;
/** …and the most it turns the head off their facing */
const headAimMaxRad = Math.PI / 4;
const tmpQuat = new THREE.Quaternion();
const tmpSwap = new THREE.Quaternion();
const tmpLean = new THREE.Quaternion();
const tmpShoulder = new THREE.Vector3();
const tmpAlong = new THREE.Vector3();
const tmpWant = new THREE.Vector3();
const tmpFrom = new THREE.Vector3();
const tmpAxis = new THREE.Vector3();

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

function bubbleHeightForClip(clipName: string): number {
  if (clipName === "sit") return 1.4;
  if (clipName === "lie") return 0.9;
  return 2;
}

/** The highest a label is lifted, standing — see `boundAnyPose` */
export const labelYShiftMax = 2.2;

function labelYShiftForClip(clipName: string): number {
  if (clipName === "sit") return 1.6;
  if (clipName === "lie") return 0.75;
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
