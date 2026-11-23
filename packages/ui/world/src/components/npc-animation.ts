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
  deathConfig,
  defaultBreathTune,
  defaultFadeSecs,
  defaultIdleAnimationClipKey,
  dragConfig,
  eyesConfig,
  fadeSecs,
  fidgetClipKeys,
  flinchConfig,
  gaitStride,
  headShakeConfig,
  hitConfig,
  hitFlinchConfig,
  lieAim,
  lieHeadMaxRad,
  lieRoll,
  npcConfig,
  npcMaterialConfig,
  npcScale,
  sitArmVia,
  sitTurn,
  stanceConfig,
  strafeEaseSecs,
  strafeSpeed,
  supportConfig,
  talkConfig,
  upperFadeSecs,
} from "../const.npc";
import { addCorpseCollider, type CorpseBody } from "../service/corpse-body";
import { helper } from "../service/helper";
import type { AnimationClipKey } from "./NPCs";
import type { Npc } from "./npc";
import { newClutch, takeClutch, tickClutch } from "./npc-clutch";
import {
  dieClips,
  finishRise,
  fitDeath,
  inTheWay,
  mirrorOf,
  pushedBack,
  rebindFall,
  restoreDead,
  riseClips,
  staggerSpot,
  startFall,
  startRise,
  tickFall,
  tickRise,
} from "./npc-death";
import { type Flinch, flinch, tickFlinch, undoFlinch } from "./npc-flinch";
import { newOverBody, removeCorpseCollider, tickOverBody, undoOverBody } from "./npc-over-body";
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
  posture: PostureKey = postureOf(defaultIdleAnimationClipKey);
  /** Metres of the head's pivot above their feet in `pose` — see `w.npc.headYByPose` */
  headY = 0;
  /** What `startIdle` returns to, and the gait on show — which follows `speed`, see `syncGait` */
  idleClip = emptyAnimationClip;
  moveClip = emptyAnimationClip;
  /** They run where they can, until told otherwise — by a move's `fast`, or the player's run button */
  hurry = false;
  /** They may run. Not which gait shows — that is `moveClip` */
  get fast() {
    return this.hurry === true && this.backwards === false && this.crouched === false && this.wallStops() === false;
  }
  /** A wall close ahead: see `setNearWall`. `ahead` is square on, which a run's lean would reach, so they slow then walk */
  nearWall: false | "ahead" | "beside" = false;
  /** Room to the wall ahead */
  wallRoom = Infinity;
  /** The clip `setNearWall` drew their right arm in with, which it alone lets go */
  armIn: null | AnimationClipKey = null;
  /** Game time until which `armIn` is held, though the wall is no longer near */
  armInUntil = 0;
  /** The move's INTENT: they back away, facing whence they go — see `w.e.move` */
  backwards = false;
  /** The move's INTENT: they keep their facing, the gait blended by heading — see `syncStrafe` */
  strafe = false;
  /** The move left `strafe` to `face.aim`, so it follows the aim mid-move — see `setStrafe` */
  strafeFollowsAim = false;
  /** Is `walk` on show as the four directional gaits — see `setPose` */
  strafing = false;
  /** Strafing, the top speed this heading allows walking and running — see `syncStrafe` */
  strafeTop = { walk: strafeSpeed.walk, run: strafeSpeed.run_ahead };
  /** Strafing, `walkNear` for this heading — see `syncStrafe` */
  strafeWalkNear: number = npcConfig.dist.walkNear;
  /** Seconds the gait on show has been on, against `agentConfig.gait.minSecs` */
  gaitSecs = 0;
  /** true iff moving via agent in navmesh */
  moving = false;
  /** Whilst a move short of `dist.shuffleTarget` steps on the spot — see `startShuffle` */
  shuffling = false;
  /** Whilst shuffling, the rest clip's upper body played on, as the shuffle keys the legs alone */
  restUpper = null as null | { action: THREE.AnimationAction; clip: THREE.AnimationClip };
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
   * `want` is the turn asked for, unclamped, and `aim` the phaser's — see `tickTurnAim`. `head`: stood, the head's alone.
   * `held` is the torso's share for a hand at their head, eased — see `tickTurn`
   */
  turn = { target: 0, value: 0, bones: [] as UpperBone[], written: false, want: 0, aim: 0, head: false, held: 0 };
  /**
   * The left hand on their phaser whilst it charges, eased by `weight`. `base` is the pose's arm before the reach,
   * `wrote` what it wrote — see `tickSupport`
   */
  support = {
    on: false,
    weight: 0,
    written: false,
    base: [new THREE.Quaternion(), new THREE.Quaternion()],
    wrote: [new THREE.Quaternion(), new THREE.Quaternion()],
  };
  /** Lain, a look whilst no arm aims: the head turns to `at` by `weight`, eased towards `on` — see `lookLain` */
  lieLook = { on: false, weight: 0, at: new THREE.Vector3() };
  /** A point the head looks at whilst no aimed arm has it, e.g. psi meeting a shot: `null` for none */
  headAt = null as null | { at: THREE.Vector3 };
  /** Their breathing: `amount` eases to `on`, and `phase` is in breaths — see `tickBreath` */
  breath = {
    on: false,
    amount: 0,
    phase: Math.random(),
    /** Multiplies their tune's rate, and its reach and glow */
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
  hurt = null as null | {
    key: AnimationClipKey;
    secs: number;
    next: null | AnimationClipKey;
    /** How fast its clip plays, e.g. a death's — see `deathConfig.dieRate` */
    rate?: number;
  };
  /** Killed: held still once their pain clip ends, until released — see `holdStill` */
  dead = false;
  /** Killed with no room to fall, they stagger to where there is first — see `staggerSpot` */
  staggering = false;
  /** Falling dead: where they stood, their hips' offset then, and the slide off a near wall — see `tickFall` */
  fall = null as null | {
    start: THREE.Vector2;
    from: THREE.Vector2;
    shift: THREE.Vector2;
    hips: THREE.Object3D;
    /** Their facing then, and how far they turn as they fall, to fit */
    ry: number;
    turn: number;
    /** What `tickFall` last wrote to their root */
    wrote: THREE.Vector3;
    /** Whether their body has hit the floor, and `npc-fell` been emitted */
    landed?: boolean;
    /** Lying still, where their body lies, for others to step over — see `npc-over-body` */
    body?: null | CorpseBody;
  };
  /** Getting up revived: their root held back by `offset` as it lay, so their body stays — see `tickRise` */
  rise = null as null | {
    offset: THREE.Vector3;
    wrote: THREE.Vector3;
    /** Where the npc was, and their hips' offset from it on the clip's first frame, as `fall`'s */
    start: THREE.Vector2;
    from: null | THREE.Vector2;
  };
  /** Whilst hurt, a hand on their wound — see `npc-clutch` */
  clutch = newClutch();
  /** Over a corpse, their feet lift — see `npc-over-body` */
  overBody = newOverBody();
  /** Seconds into a shake of the head, else `null` — see `shakeHead` */
  headShake = null as null | number;
  /** Whilst they speak: seconds left, seconds in, how far the head's motion is eased in, and whether `talk_left` is ours */
  talking = { secs: 0, t: 0, weight: 0, gesture: false };
  /** A jolt from a shot armour took, easing out, else `null` — see `flinch` */
  flinchAt = null as null | Flinch;
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

  /** The player's is the World's, set in their bubble: anyone else's the default. Read each tick, so not a copy */
  get breathTune() {
    return (this.npc.key === this.w.player?.key ? this.w.npc.breathTune : undefined) ?? defaultBreathTune;
  }

  /** How low they crouch: `0` stood, `1` half (`crouch_half`), `2` full (`crouch_cover`). Their gaits follow */
  get crouchLevel(): CrouchLevel {
    const key = keyOf(this.idleClip);
    return key === "crouch_cover" ? 2 : key === "crouch_half" ? 1 : 0;
  }

  /** Crouched at all, half or full */
  get crouched() {
    return this.crouchLevel > 0;
  }

  /** Collapsed on the floor: a move scoots them back-first in `collapsed_drag` */
  get dragged() {
    return this.hurt?.key === "collapsed" && this.dead !== true;
  }

  /** The four directional gaits a strafe blends: a short move's, else by how low they crouch, else running or walking as `pose` shows */
  get gaitKeys() {
    if (this.shuffling === true) return shuffleStepClipKeys;
    if (this.crouchLevel > 0) return gaitSets[this.crouchLevel];
    return isRun(this.pose) && this.backwards === false ? runStrafeClipKeys : strafeClipKeys;
  }

  /** What they stand, sit or lie in at rest: the hurt clip whilst there is one */
  get restKey() {
    return this.hurt?.key ?? keyOf(this.idleClip);
  }

  get w(): UseStateRef<import("./World").State> {
    return this.npc.w;
  }

  constructor(npc: Npc) {
    this.npc = npc;
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

  /** `face.aim.at` as a world angle, a point's from where they stand */
  bearingOf(at: Geom.VectJson | number) {
    return typeof at === "number"
      ? at
      : geomService.getThreeRotationY(at.y - this.npc.position.z, at.x - this.npc.position.x);
  }

  /** They blink, over whatever look they have */
  blink(count = 1) {
    this.eyes.blinks = count;
    this.eyes.blinkSecs = 0;
    this.tickEyes(0);
  }

  /** The clip a resting pose breathes by, which a breath runs by its own clock instead */
  breathClock() {
    return breathClips.has(this.pose) ? this.mixer.existingAction(this.npc.clips[this.pose]) : null;
  }

  /** They can aim at `at` as they are: sat, within `sitTurn`'s aim, lain, within their pose's `lieAim` */
  canAimAt(at: Geom.VectJson) {
    if (this.posture === "lie") return this.lieAimPoseFor(at) === this.pose;
    if (this.posture === "stand") return true;
    const off = deltaAngle(this.npc.rotation.y, this.bearingOf(at));
    return off >= sitTurn.aimFrom && off <= sitTurn.aimTo;
  }

  /** Their head faces ahead at once, rather than easing round: e.g. respawned unseen */
  faceAhead() {
    this.headTurn.identity();
    Object.assign(this.turn, { aim: 0, target: 0, value: 0, want: 0, head: false, held: 0 });
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

  /** The clip a hit on `part` plays, by whether they stand, sit or lie — `null` for none */
  hitClipFor(part: null | string, outcome?: HitOutcome, dir?: THREE.Vector3): null | AnimationClipKey {
    const region = hitConfig.region[part ?? ""];
    if (region === undefined) return null;
    const posture = postureOf(keyOf(this.idleClip));
    /** Held down already, e.g. collapsed: they stay so, rather than sink again */
    const held = this.hurt !== null && onceClips.has(this.hurt.key) === false;
    const sink = outcome === "down" && posture === "stand" && region === "torso" && held === false;
    if (outcome === "kill" && posture === "stand")
      return deathConfig.die[pushedBack(dir, this.npc.rotation.y) ? "back" : "forward"];
    return sink ? hitConfig.sink : hitConfig.clips[posture][region];
  }

  /** Hit whilst collapsed: a stood pain clip would stand them, so they stay down, jolted. Killed, they stop there */
  hitDown(impact?: HitImpact) {
    takeClutch(this.clutch, this, impact);
    if (impact?.outcome !== "kill") return;
    this.dead = true;
    this.holdStill();
    this.w.events.next({ key: "npc-hurt", npcKey: this.npc.key, clip: this.hurt?.key ?? null, dead: true });
  }

  /** Killed: their pose stops, eyes shut and not breathing. A clip played once stops at its end, else at `deadSecs` */
  holdStill() {
    const clip = this.npc.clips[this.restKey];
    const action = this.mixer.existingAction(clip);
    if (action !== null) {
      action.time = onceClips.has(this.restKey) ? clip.duration : deathConfig.deadSecs;
      action.paused = true; // `setPose` resets it, so the next pose plays
    }
    if (this.breath.on === true) this.setBreathing(false);
    this.setEyes("shut");
    if (this.fall != null && this.fall.body == null) this.fall.body = addCorpseCollider(this.npc);
  }

  /**
   * Holds the right arm's muzzle (`aim.from`) on `hold` by `weight`, pointing along it turned towards `aim.at` by `aim.weight`.
   * The muzzle may slide along the line, so the upper arm keeps its length: the body moves under the gun
   */
  holdGun(aim: UpperAim, hold: THREE.Ray, weight: number) {
    const [entry, foreEntry] = this.upper.bones;
    const [arm, fore] = [entry?.bone, foreEntry?.bone];
    if (arm?.parent == null || fore === undefined) return;
    // in the chest's frame: the hold is brought in once, then the bones' own turns suffice
    arm.parent.updateWorldMatrix(true, false);
    const toChest = tmpToChest.copy(arm.parent.matrixWorld).invert();
    const origin = tmpOrigin.copy(hold.origin).applyMatrix4(toChest);
    const dir = tmpDir.copy(hold.direction).transformDirection(toChest);
    if (aim.weight > 0) {
      // turned towards `aim.at`, as `aimArm` would
      const toAt = tmpToAt.copy(aim.at).applyMatrix4(toChest).sub(origin).normalize();
      const off = dir.angleTo(toAt);
      const turn = Math.min(off, aim.maxRad ?? upperAimMaxRad) * aim.weight;
      if (off > 1e-4) dir.applyAxisAngle(tmpAxis.crossVectors(dir, toAt).normalize(), turn);
    }
    const upper = tmpUpper.copy(fore.position).applyQuaternion(arm.quaternion);
    const foreQuat = tmpForeQuat.multiplyQuaternions(arm.quaternion, fore.quaternion);
    const along = tmpAlong.set(0, -1, 0).applyQuaternion(foreQuat);
    /** Elbow to muzzle, once the forearm points along `dir` */
    const muzzle = tmpMuzzle
      .copy(aim.from)
      .applyQuaternion(foreQuat)
      .applyQuaternion(tmpAlign.setFromUnitVectors(along, dir));
    // the elbow `s` along the line from `hold`'s, as far from the shoulder as the upper arm is long
    const c = tmpWant.copy(origin).sub(muzzle).sub(arm.position);
    const b = c.dot(dir);
    const root = Math.sqrt(Math.max(0, b * b - c.lengthSq() + upper.lengthSq()));
    const want = c.addScaledVector(dir, -b + (b < 0 ? -root : root)).normalize(); // the nearer `s`
    const swing = tmpAlign.setFromUnitVectors(upper.normalize(), want);
    entry.written.copy(arm.quaternion.premultiply(tmpPart.identity().slerp(swing, weight)));
    // the forearm along `dir`: that turn as the arm sees it
    along.set(0, -1, 0).applyQuaternion(foreQuat.multiplyQuaternions(arm.quaternion, fore.quaternion));
    const bend = tmpAlign.setFromUnitVectors(along, dir).premultiply(tmpInverse.copy(arm.quaternion).invert());
    bend.multiply(arm.quaternion);
    foreEntry.written.copy(fore.quaternion.premultiply(tmpPart.identity().slerp(bend, weight)));
  }

  /** A roll in bed is still fading in */
  isRolling() {
    return this.w.gameTime.now() - this.rolledAt < lieRoll.secs;
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

  /**
   * Turn to face `target` (radians) over a duration set by the arc, shuffling round a long one, and resolve
   * `npc.resolve.look` on landing — setting off at `fromRate`, a superseded look's, rather than restarting
   */
  lookAt(target: number, minMs: number, rate = 1, fromRate = 0) {
    const start = this.npc.rotation.y;
    const diff = deltaAngle(start, target);
    const arc = Math.abs(diff);
    // a shuffle under way carries on, crossfading to idle as the turn lands. Crouched they turn on the spot: it is stood
    const longLook = this.crouched === false && (arc > longLookAngle || (fromRate !== 0 && this.pose === "shuffle"));
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

  /** Lain, look towards `at` as a phaser aims: rolled to the pose that reaches it, the head lifting to it, and held there */
  lookLain(at: Geom.VectJson) {
    if (this.posture !== "lie") return;
    const pose = this.lieAimPoseFor(at);
    if (pose !== null && this.isRolling() === false) this.rollOnto(pose); // a roll cut short by the next jerks them
    this.lieLook.on = true;
    this.lieLook.at.set(at.x, this.npc.position.y + this.headY, at.y);
    this.w.r3f?.invalidate();
  }

  /** The agent's top speed for the move's intent: a strafe's is then `syncStrafe`'s, by heading */
  maxSpeedFor() {
    const { maxSpeed } = agentConfig;
    if (this.dragged === true) return dragConfig.speed;
    if (this.crouched === true) return strafeSpeed[this.gaitKeys[0]];
    if (this.strafe === true) return this.fast === true ? strafeSpeed.run_ahead : strafeSpeed.walk;
    return this.backwards === true ? maxSpeed.backwards : this.fast === true ? this.runSpeed() : maxSpeed.walk;
  }

  /** A straight run's top speed. A wall square ahead slows it to `runLeast` at `walkNear` */
  runSpeed() {
    const { run, runLeast } = agentConfig.maxSpeed;
    if (this.nearWall !== "ahead") return run;
    const { armInNear, walkNear } = npcConfig.dist;
    const t = THREE.MathUtils.clamp((this.wallRoom - walkNear) / (armInNear.run - walkNear), 0, 1);
    return runLeast + (run - runLeast) * t;
  }

  /** Whether a wall square ahead has them walk: within `walkNear`, strafing its share by heading */
  wallStops() {
    return this.nearWall === "ahead" && this.wallRoom < (this.strafe ? this.strafeWalkNear : npcConfig.dist.walkNear);
  }

  /** As the pose left the arm, before `held` reached with it, unless its clip has written it since */
  putBackArm(side: Side, held?: { written: boolean; base: THREE.Quaternion[]; wrote: THREE.Quaternion[] }) {
    if (held?.written !== true) return;
    const { bones } = this.upperOf(side);
    for (let i = 0; i < 2; i++) {
      const bone = bones[i]?.bone;
      if (bone?.quaternion.equals(held.wrote[i]) === true) bone.quaternion.copy(held.base[i]);
    }
    held.written = false;
  }

  /** Brings an arm's hand to `to`, a world point, by `weight`. The elbow goes towards `elbowTo`, else stays its side */
  reachTo(side: Side, to: THREE.Vector3, weight: number, elbowTo?: THREE.Vector3) {
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
    // two bones to a point: the elbow lies `along` the reach and `out` from it, towards `elbowTo`, else where it is now
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const out = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    const hint = elbowTo ?? arm;
    const pole = tmpPole.copy(hint).addScaledVector(reach, -hint.dot(reach)).normalize();
    const elbow = tmpAlong.copy(reach).multiplyScalar(along).addScaledVector(pole, out).normalize();
    const swing = turnWithin(upper.bone.parent, arm.normalize(), elbow, Math.PI, weight);
    if (swing !== null) upper.written.copy(upper.bone.quaternion.premultiply(swing));

    fore.bone.updateWorldMatrix(true, false);
    const from = tmpFrom.setFromMatrixPosition(fore.bone.matrixWorld);
    const tipNow = fore.bone.localToWorld(tmpTip.copy(fore.bone.position)).sub(from).normalize();
    const want = reach.multiplyScalar(d).add(shoulder).sub(from).normalize();
    const bend = turnWithin(upper.bone, tipNow, want, Math.PI, weight);
    if (bend === null) return;
    // the forearm keeps its roll about its length, as an elbow does: else it turns within the cuff
    splitTwist(fore.bone.quaternion, tmpSwingFrom, tmpTwistFrom);
    splitTwist(fore.bone.quaternion.premultiply(bend), tmpSwingTo, tmpTwistTo);
    fore.written.copy(fore.bone.quaternion.multiplyQuaternions(tmpSwingTo, tmpTwistFrom));
  }

  /** The living where their fall lies, with where they step aside to — see `npc-death` */
  inTheWay() {
    return inTheWay(this);
  }

  /**
   * Dead as restored, e.g. from a save, held at the end of `clip` — see `npc-death`.
   * By default sat or lain as their idle is, else fallen either way
   */
  restoreDead(clip?: AnimationClipKey) {
    if (this.stance.held === true) letGo(this.stance); // a hold from standing would sink them through the floor
    const fall = deathConfig.die[Math.random() < 0.5 ? "back" : "forward"];
    const fallen = Math.random() < 0.5 ? (mirrorOf.get(fall) ?? fall) : fall;
    restoreDead(this, clip ?? deathConfig.dead[postureOf(keyOf(this.idleClip))] ?? fallen);
  }

  /** Where they stagger to, killed by `clip` with no room to fall here — see `npc-death` */
  staggerSpot(clip: null | AnimationClipKey, dir?: THREE.Vector3) {
    return staggerSpot(this, clip, dir);
  }

  /** Roll one lain onto `to`, a lie clip */
  rollOnto(to: AnimationClipKey) {
    const from = keyOf(this.idleClip);
    if (isLieKey(from) === false || to === from) return;
    this.rolledAt = this.w.gameTime.now();
    this.idleClip = this.npc.clips[to];
    if (this.pose === from) this.setPose(to);
    this.w.r3f?.invalidate();
  }

  /** Breathe, or stop: eased either way, and nobody does until asked — see `docs/npc-breath.md` */
  setBreathing(on: boolean) {
    const { breath } = this;
    breath.on = on;
    // from where the pose's own breath has them, so nothing jumps
    const clock = on === true ? this.breathClock() : null;
    if (clock !== null) breath.phase = phaseOfClip(clock, this.breathTune.inhale);
    this.w.r3f?.invalidate();
    this.w.events.next({ key: "npc-toggled", npcKey: this.npc.key });
  }

  /** Crouch to `level`, or stand back up into the default idle with `0`. Only from standing, never sat or lain */
  setCrouch(level: CrouchLevel) {
    if (level === this.crouchLevel) return;
    if (level > 0 && (this.posture !== "stand" || this.w.npc.npcToDoable[this.npc.key] != null)) return;
    this.idleClip = this.npc.clips[crouchIdleKeys[level]];
    if (this.moving === false) return this.setPose(this.restKey);
    this.showGait(); // mid-move, the other gaits
    this.syncMaxSpeed();
  }

  /** Their eyes take a look, whatever their pose */
  setEyes(look: EyesKey) {
    this.eyes.look = look;
    this.eyes.secs = 0;
    this.tickEyes(0);
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

  /** Run, or stop running, mid-move: the gait follows their speed — see `syncGait` */
  setHurry(hurry: boolean) {
    this.hurry = hurry;
    this.syncMaxSpeed();
  }

  /**
   * Show `key` in place of idle: a pain clip once, a looped one e.g. pacified until `null` releases them.
   * Released, a fallen corpse gets up first. With `snap` they are let go at once, with no fade
   */
  setHurt(key: null | AnimationClipKey, impact?: HitImpact, { snap = false } = {}) {
    const dead = this.dead === true;
    if (impact !== undefined) flinch(this, impact.part, impact.at, impact.dir, dead ? flinchConfig : hitFlinchConfig);
    if (key !== null && dead) return; // a corpse only jolts
    if (key === null && dead && !snap && startRise(this) === true) return;
    const kill = impact?.outcome === "kill";
    /** Radians they turn as they fall dead, to fit — see `fitDeath` */
    let [turn, slide] = [0, null as null | Geom.VectJson];
    if (key !== null && dieClips.has(key)) {
      [key, turn, slide] = fitDeath(this, key, impact?.dir);
      if (Math.random() < 0.5) key = mirrorOf.get(key) ?? key; // either way round
    }
    /** The looped clip they are in, e.g. pacified or collapsed: a pain clip goes back to it */
    const held = this.hurt !== null && onceClips.has(this.hurt.key) === false ? this.hurt.key : null;
    const pacified = held !== null && isPacified(held);
    if (key !== null && kill === false && pacified && (isPacified(key) || headClips.has(key))) return;
    if (key !== null && held === "collapsed" && postureOf(key) === "stand") return this.hitDown(impact);
    const changed = key !== (this.hurt?.key ?? null);
    /** Put down: collapsed or pacified after, as `hitConfig.next`. Else they recover. A clip set by hand always is */
    const down = impact === undefined || impact.outcome === "down";
    /** What follows the clip: killed, the dead pose. One pacified stays so, whatever else hits them */
    const next = kill
      ? (deathConfig.dead[postureOf(keyOf(this.idleClip))] ?? null)
      : key !== null && down && pacified === false
        ? (hitConfig.next[key] ?? held)
        : held;
    const rate = key !== null && dieClips.has(key) ? THREE.MathUtils.randFloat(...deathConfig.dieRate) : 1;
    this.hurt = key === null ? null : { key, secs: 0, next, rate };
    if (key !== null) {
      this.dead = kill;
      this.rise = null; // e.g. killed again as they get up
      takeClutch(this.clutch, this, impact);
      if (dieClips.has(key)) startFall(this, turn, slide);
    } else if (dead || this.eyes.look === "scared" || this.fall != null) {
      this.dead = false;
      this.setEyes("open");
      if (this.fall != null) {
        removeCorpseCollider(this);
        finishRise(this);
        this.fall = null;
        // back in the crowd, on the nearest poly: none near, they stay where they lie
        const near = this.w.npc.getClosestPoly(this.npc.position, 0.5);
        if (near.success === true) this.w.npc.placeNpcAt(this.npc, near);
      }
    }
    const fade = key !== null ? hitConfig.fadeInSecs : snap ? 0 : undefined;
    this.setPose(this.restKey, { force: key !== null, fade });
    if (key !== null) this.mixer.existingAction(this.npc.clips[key])?.setEffectiveTimeScale(rate);
    if (key === hitConfig.sink) this.setEyes("scared"); // until released
    this.w.r3f?.invalidate();
    if (changed) this.w.events.next({ key: "npc-hurt", npcKey: this.npc.key, clip: key, dead: this.dead });
  }

  /** Whether a wall is within `armInSide` ahead of them or to their right, the gun's side */
  isWallByArm() {
    const { nodeRef, point, rotation } = this.npc;
    if (nodeRef === null) return false;
    const { armInSide } = npcConfig.dist;
    const [ahead, right] = [
      { x: -Math.sin(rotation.y), y: -Math.cos(rotation.y) },
      { x: Math.cos(rotation.y), y: -Math.sin(rotation.y) },
    ];
    return [ahead, right].some((way) => this.npc.roomAhead(point, nodeRef, armInSide, way, way).room < armInSide);
  }

  /**
   * A wall close ahead, from `move` on each held step of `wasd_delta --nav`. Stood with a gun in hand, it draws their right arm
   * in as `phaser_aim_avoid` whilst free, e.g. not raised nor reaching. `room` is how far off the wall is
   */
  setNearWall(next: false | "ahead" | "beside", room = Infinity) {
    this.nearWall = next;
    this.wallRoom = room;
    this.syncMaxSpeed();
    const now = this.w.gameTime.now();
    if (next !== false) this.armInUntil = now + npcConfig.time.armInHold;
    else if (this.armIn !== null && now < this.armInUntil) {
      // held a moment, then let go if still clear
      this.w.e.after(this.armInUntil - now, () => this.nearWall === false && this.setNearWall(false));
      return;
    }
    /** Without a gun in hand the arm swings on: held still, it reads as carrying one */
    const want = next !== false && this.posture === "stand" && this.w.phasers?.holds(this.npc.key) === true;
    // let go, or taken over e.g. raised: no longer ours
    if (this.upper.target === 0 || this.upper.key !== this.armIn) this.armIn = null;
    if (want === (this.armIn !== null)) return;
    if (this.armIn !== null) {
      this.setUpper(null, { byWall: false }); // no wall near by now: at rest by one, `startIdle` keeps it in
      this.armIn = null;
    } else if (this.upper.target === 0) {
      this.armIn = "phaser_aim_avoid";
      // the player's folds at the elbow first, else the gun swings out into the wall
      this.setUpper(this.armIn, { byWall: false, fold: this.w.player?.is(this.npc.key) === true });
    }
  }

  /** The ONLY way the clip on show changes: everything else fades out as `next` fades in */
  setPose(next: AnimationClipKey, { fade = fadeSecs[this.pose]?.[next] ?? defaultFadeSecs, force = false } = {}) {
    if (next === this.pose && force === false) {
      return;
    }

    const shown = this.strafe === true ? (strafeSets.find((keys) => keys[0] === next) ?? [next]) : [next];
    /** Strafing from one set to another, e.g. walk to run: each gait takes its counterpart's weight */
    const from =
      this.strafing === true && shown.length > 1 ? strafeSets.find((keys) => keys[0] === this.pose) : undefined;
    const weightOf = (i: number) =>
      from === undefined ? (i === 0 ? 1 : 0) : (this.mixer.existingAction(this.npc.clips[from[i]])?.weight ?? 0);
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
    action.weight = weightOf(0); // `syncStrafe` weighs the four, fading or not
    for (const [i, key] of shown.slice(1).entries()) {
      const other = this.mixer.clipAction(clips[key]).reset().play();
      other.weight = weightOf(i + 1);
      if (kept === false && fade > 0) other.fadeIn(fade); // else `syncStrafe` eases them in from nought
    }
    this.strafing = shown.length > 1;
    // walk <-> run: the phase carries over, else the feet pop
    const prev = this.mixer.existingAction(clips[this.pose]);
    if (kept === false && prev !== null && isGait(this.pose) && isGait(next)) {
      action.time = (prev.time / clips[this.pose].duration) * clips[next].duration;
    }
    if (this.pose === "shuffle") this.mixer.timeScale = 1; // see `lookAt`
    const { restUpper } = this;
    if (restUpper !== null && (shuffleStepClipKeys as AnimationClipKey[]).includes(next) === false) {
      // the shuffle's legs give way: its upper body hands back, in step if to the clip it came from
      if (clips[next] === restUpper.clip) action.time = restUpper.action.time;
      restUpper.action.fadeOut(Math.max(fade, minFadeSecs));
      this.restUpper = null;
    }
    const crouchMove = isCrouch(this.pose) || isCrouch(next); // their label glides
    const rising = riseClips.has(next); // their label rises with them, over the whole clip
    const { group } = this.npc;
    if (stanceConfig.on && group !== null && isStride(this.pose) && isStill(next))
      takeStance(this.stance, group, this.npc);
    this.pose = next;
    this.posture = postureOf(next);
    // sat or lain they are elsewhere, and a hold easing out would slide them on the seat
    if (this.stance.held === true && this.posture !== "stand") letGo(this.stance);
    /** The pose they look to be in: a fall dead starts stood, but they end lain */
    const looks = dieClips.has(next) ? "lie" : next;
    this.headY = this.w.npc.headYByPose[looks];
    this.npc.setBubbleHeight(bubbleHeightForClip(looks));
    this.npc.setLabelYShift(
      labelYShiftForClip(looks),
      crouchMove || looks !== next || rising,
      rising ? clips[next].duration : undefined,
    );
    this.w.events.next({ key: "npc-posed", npcKey: this.npc.key });
  }

  /** Start or stop strafing mid-move, as `face.aim` comes or goes: stopping eases out in `syncStrafe` */
  setStrafe(strafe: boolean) {
    this.strafe = strafe;
    this.backwards = false;
    if (this.npc.agent !== null) this.npc.agent.maxSpeed = this.maxSpeedFor();
    this.showGait();
  }

  /**
   * Ease `key` in over an arm (and the head), or out with `null`, over `fadeSecs` — from another shown, in `swapSecs`.
   * `played`: start the clip at `0` and at full weight, for one whose first frame IS the pose e.g. `sit_reach`.
   * `past`: sat at a table (`isUnderTable`), the arm goes up and comes down by way of `sitArmVia`, past its edge.
   * `byWall`: stood, likewise, so the hand keeps in. Kept until given again, a lowering included.
   * `fold`: by Euler angles (`foldMix`), so the elbow bends before the forearm swings in. Kept until another key, a lowering included.
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
      byWall = undefined as undefined | boolean,
      fold = false,
    } = {},
  ) {
    const u = this.upperOf(side);
    if (side === "left") this.talking.gesture = false; // whoever sets it last owns it, e.g. a pose
    u.fadeSecs = fadeSecs;
    if (key !== null) Object.assign(u, { past, onHead, fold });
    if (byWall !== undefined) u.byWall = byWall;
    if (played === true) Object.assign(u, { time: 0, blend: 1 });
    if (key !== null && u.key !== null && key !== u.key && u.blend > 0) {
      // shown: ease over from where they are, in `swapSecs`
      for (const b of u.bones) b.from.copy(b.written);
      Object.assign(u, { swap: 0, swapSecs });
    }
    if (key !== null) u.key = key;
    u.target = key === null ? 0 : 1;
  }

  /**
   * Their head moves for `secs` as they speak, over any pose or shake. `0` stops it.
   * With `gesture`, their left arm talks too whilst it may — see `canGesture`
   */
  talk(secs: number, gesture = false) {
    const { talking } = this;
    if (talking.weight === 0) talking.t = 0;
    talking.secs = secs;
    if (secs > 0 && gesture === true && this.canGesture()) {
      if (this.upperLeft.key !== "talk_left") this.setUpper("talk_left", { side: "left" });
      talking.gesture = true;
    } else this.endGesture();
    this.w.r3f?.invalidate();
  }

  /** Whether their left arm may talk: free or already ours, stood or sat, and no wall near */
  canGesture() {
    const { key } = this.upperLeft;
    const free = key === null || (key === "talk_left" && this.talking.gesture === true);
    const upright = this.posture === "stand" || this.posture === "sit";
    return free && upright && this.support.on === false && this.nearWall === false && this.hurt === null;
  }

  /** Lets go of `talk_left` if we set it, e.g. not a pose's */
  endGesture() {
    const { talking, upperLeft } = this;
    if (talking.gesture === true && upperLeft.key === "talk_left" && upperLeft.target === 1)
      this.setUpper(null, { side: "left" });
    talking.gesture = false;
  }

  /** A "no": they shake their head, over whatever pose or upper clip has it */
  shakeHead() {
    this.headShake = 0;
    this.w.r3f?.invalidate();
  }

  /** Show the move's gait unless on show: a walk runs on into a move's next leg, a strafe let go eases out in `syncStrafe` */
  showGait() {
    const [ahead, , back] = this.gaitKeys;
    // collapsed, the scoot. Else ahead, or a half turn round. A run not strafing swings its arms
    const clipKey =
      this.dragged === true
        ? "collapsed_drag"
        : this.backwards === true
          ? back
          : ahead === "run_ahead" && this.strafe === false
            ? "run"
            : ahead;
    // a look or a spawn in between puts idle on, and it must be shown again or they slide
    const shown = this.backwards === true || this.crouched || this.dragged ? this.pose === clipKey : isGait(this.pose);
    if (this.moving === true && shown === true && (this.strafe === false || this.strafing === true)) return;
    this.moving = true;
    this.moveClip = this.npc.clips[clipKey];
    this.gaitSecs = 0;
    this.setPose(clipKey, { force: this.strafing !== this.strafe });
  }

  startIdle({ force = false } = {}) {
    this.npc.resolve.move("idle");
    if (this.shuffling === true) [this.shuffling, this.strafe] = [false, false];

    const skip = !this.arrive && !force;
    this.arrive = true;

    if (skip) {
      return;
    }

    // at rest by a wall the arm stays in, else the next step flicks it. Else let go, e.g. killed or no longer the player
    this.setNearWall(this.armIn !== null && this.isWallByArm() ? "beside" : false);
    this.npc.last.idleTime = this.w.gameTime.now();
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
      const ahead = this.w.npc.getClosestPoly({ x: pinX, y: pinZ }, 0.1);
      // past an edge they are pressed against, ahead is off the navmesh: pinned where they stand instead
      if (this.npc.pinTo(ahead) === false) this.npc.pinTo(this.w.npc.getClosestPoly(this.npc.point, 0.1));
    }

    this.face.rate = 0;
    const { aim } = this.face;
    if (aim?.untilRest === true) this.face.aim = null;
    this.setPose(this.restKey, { force: this.moving });
    this.moving = false;
    // a look on the move they arrived before finishing: the rest of it on the spot
    if (aim?.untilRest === true) this.lookAt(this.bearingOf(aim.at), 0, aim.rate);
  }

  /**
   * Show the gait — walk, from rest: `syncGait` breaks into a run — and release the agent `aimAt` pinned. A mirror npc
   * has no agent: its movement arrives over the network (see `use-world-net`)
   */
  startMoving(arrive = true) {
    this.shuffling = false; // e.g. a walk taking over a shuffle
    const agent = this.npc.agent;
    if (agent !== null) {
      // both on release: `onTick` drops the acceleration of anyone at rest, the pinned included
      agent.maxAcceleration = agentConfig.maxAcceleration.walk;
      agent.maxSpeed = this.maxSpeedFor();
    }
    // after the turn, so a long one does not eat the stuck grace
    this.npc.last.moveTime = this.w.gameTime.now();
    this.arrive = arrive;
    this.showGait();
  }

  /** Steps whilst the crowd eases them a short way, keeping their facing: `syncStrafe` blends `shuffleStepClipKeys` by heading */
  startShuffle(to: Geom.VectJson) {
    const { agent } = this.npc;
    if (agent !== null) {
      agent.maxAcceleration = agentConfig.maxAcceleration.idle;
      agent.maxSpeed = this.shuffleSpeed();
    }
    this.npc.last.moveTime = this.w.gameTime.now();
    [this.arrive, this.backwards, this.strafe, this.strafing] = [true, false, true, false];
    this.strafeFollowsAim = false; // else, not aiming, it is let go as a walk
    this.shuffling = true;
    this.moving = true;
    this.moveClip = this.npc.clips.shuffle_step;
    // the shuffle keys the legs alone: the rest clip carries on above them, from where it is
    const restClip = this.npc.clips[this.restKey];
    const upper = this.mixer.clipAction(upperOf(restClip)).reset().play();
    upper.time = this.mixer.existingAction(restClip)?.time ?? 0;
    this.restUpper = { action: upper, clip: restClip };
    this.setPose("shuffle_step");
    // stepping the way they go from the first step, rather than eased round from ahead
    const { clips, position, rotation } = this.npc;
    const heading = headingOf(rotation.y, to.x - position.x, to.y - position.z);
    shuffleStepClipKeys.forEach((key, i) => void (this.mixer.clipAction(clips[key]).weight = gaitWeight(heading, i)));
  }

  /**
   * A shuffle's top speed, `maxSpeed.shuffle` but for the crowd's slowdown within twice their radius of the target:
   * there it scales speed by the distance, which this undoes to its root, so they ease in but arrive
   */
  shuffleSpeed() {
    const { agent, position } = this.npc;
    if (agent === null) return agentConfig.maxSpeed.shuffle;
    const [tx, , tz] = agent.targetPosition;
    const [d, r] = [Math.hypot(tx - position.x, tz - position.z), 2 * agent.radius];
    return agentConfig.maxSpeed.shuffle * Math.sqrt(r / Math.min(r, Math.max(d, npcConfig.dist.arriveMin)));
  }

  /** Whilst `fast` the gait follows `speed` — with hysteresis, and a least time on each — else walk. Strafing, by heading */
  syncGait(delta: number) {
    if (this.backwards === true) return; // one gait
    const { runAbove, walkBelow, minSecs } = agentConfig.gait;
    this.gaitSecs += delta;
    const running = isRun(keyOf(this.moveClip));
    // strafing, a walk this way tops out at `strafeTop.walk`, not `maxSpeed.walk`
    const scale = this.strafe === true ? this.strafeTop.walk / agentConfig.maxSpeed.walk : 1;
    const next = this.fast === true && (running ? this.speed >= walkBelow * scale : this.speed > runAbove * scale);
    if (next === running || this.gaitSecs < minSecs || isGait(this.pose) === false) return;
    this.gaitSecs = 0;
    this.moveClip = this.npc.clips[next === false ? "walk" : this.strafe === true ? "run_ahead" : "run"];
    this.setPose(keyOf(this.moveClip));
  }

  /** Mid-move, the agent's top speed follows a change of intent. Not whilst pinned (`0`), nor strafing (`syncStrafe`'s) */
  syncMaxSpeed() {
    const { agent } = this.npc;
    if (agent !== null && this.moving === true && this.strafe === false && agent.maxSpeed > 0)
      agent.maxSpeed = this.maxSpeedFor();
  }

  /** Weigh the directional gaits by heading relative to facing — the nearest two — and keep them in step, paced and sped by that way */
  syncStrafe(delta: number) {
    const { clips, agent, rotation } = this.npc;
    const keys = this.gaitKeys;
    const actions = keys.map((key) => this.mixer.clipAction(clips[key]));
    const [vx, , vz] = agent?.velocity ?? [0, 0, 0];
    const ease = 1 - Math.exp(-delta / strafeEaseSecs); // alike for all four, so they still sum to 1
    if (this.strafe === false) {
      // let go mid-move: all to `walk`, which then shows alone
      actions.forEach((action, i) => void (action.weight += ((i === 0 ? 1 : 0) - action.weight) * ease));
    } else if (Math.hypot(vx, vz) >= 0.05) {
      // creeping, their velocity swings about: the last weights are kept
      const heading = headingOf(rotation.y, vx, vz);
      actions.forEach((action, i) => void (action.weight += (gaitWeight(heading, i) - action.weight) * ease));
    }
    const blend = (byKey: Partial<Record<GaitKey, number>>, set: readonly GaitKey[] = keys) =>
      actions.reduce((sum, action, i) => sum + action.weight * (byKey[set[i]] ?? 0), 0);
    const { strafeTop } = this;
    strafeTop.walk = blend(strafeSpeed, strafeClipKeys);
    strafeTop.run = blend(strafeSpeed, runStrafeClipKeys);
    this.strafeWalkNear = blend(npcConfig.dist.strafeWalkNear, runStrafeClipKeys);
    // as fast as that way allows, running whilst `fast`
    if (agent !== null && this.strafe === true)
      agent.maxSpeed = this.shuffling ? this.shuffleSpeed() : this.fast === true ? strafeTop.run : blend(strafeSpeed);

    const [walk] = actions;
    // `tick`'s pace, a cycle per ground the blend covers
    const timeScale = (walk.timeScale * walk.getClip().duration) / (blend(gaitStride) || 1);
    const phase = walk.time / walk.getClip().duration;
    actions.forEach((action, i) => {
      action.timeScale = timeScale;
      if (i === 0) return;
      // the third, `backwards` or `crouch_backwards`, is the first reversed: a half cycle on, the same foot swings
      const offset = i === 2 ? 0.5 : 0;
      action.time = ((phase + offset) % 1) * action.getClip().duration;
    });
    if (this.strafe === false && walk.weight > 0.99) {
      const key = keys[0] === "run_ahead" ? "run" : keys[0]; // its arms swing again
      this.moveClip = clips[key];
      this.setPose(key, { force: true });
    }
  }

  /** The ONLY per-frame work: the mixers, the colour fade, the gait's pace, and the facing */
  tick(delta: number) {
    this.mixer.update(delta);
    rebindFall(this);
    tickFall(this);
    tickRise(this);
    undoFlinch(this);
    // as the pose and its arms' clips left them, before either reads them again
    if (this.turn.written === true) {
      for (const { bone, base, written } of this.turn.bones)
        if (bone.quaternion.equals(written)) bone.quaternion.copy(base);
      this.turn.written = false;
    }
    this.putBackArm("left", this.support);
    this.putBackArm(this.clutch?.side ?? "left", this.clutch);
    undoOverBody(this.overBody);
    this.tickLieLook(delta);
    this.tickUpper(delta);
    this.tickHead(delta);
    this.tickTurn(delta);
    this.tickAimArm();
    this.tickSupport(delta);
    this.npc.easeLabel(delta);
    this.tickHurt(delta);
    this.tickBreath(delta);
    if (this.eyes.busy === true) this.tickEyes(delta);
    const { stance } = this;
    if (stance.held === true && this.npc.group !== null)
      tickStance(stance, this.npc.group, isStill(this.pose), delta, this.npc);
    if (this.overBody !== undefined) tickOverBody(this.overBody, this, delta);
    tickFlinch(this, delta); // over what every other wrote
    // last, so the hand meets the wound where the flinch and stance leave it
    if (this.clutch !== undefined) tickClutch(this.clutch, this, delta);

    const { fadeState: f, face } = this;
    const { colorScale, rotation } = this.npc;

    const { aim } = face;
    // sat or lain their body keeps its facing, e.g. a seat's: else an aim not yet let go turns it
    if (aim && face.turn === null && this.posture === "stand") {
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
    this.tickRoomLit(delta);

    if (this.moving === true) {
      if (this.shuffling === false) this.syncGait(delta);
      const key = keyOf(this.moveClip);
      const action = this.mixer.clipAction(this.moveClip);
      if (this.shuffling === true) {
        // at their speed, which the crowd eases to nothing: `syncStrafe` divides by the blend's stride
        action.timeScale = Math.max(this.speed, shufflePaceMin);
      } else if (isCrouchGait(key)) {
        // a cycle a stride, at their speed: a strafe divides by the blend's in `syncStrafe`
        const pace = Math.max(this.speed, crouchPaceMin);
        action.timeScale = this.strafing === true ? pace : pace / gaitStride[key];
      } else if (key === "collapsed_drag") {
        action.timeScale = Math.max(this.speed, crouchPaceMin) / dragConfig.stride;
      } else {
        const pace = Math.max(0.25 / npcScale, this.speed, 0.5);
        // a straight run a cycle a stride: a strafe divides by the blend's in `syncStrafe`
        action.timeScale =
          key === "run" && this.strafing === false ? (pace * this.moveClip.duration) / gaitStride.run : pace;
      }
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

  /** After `tickTurn`, so a sat turn of the torso is allowed for */
  tickAimArm() {
    const r = this.upper;
    if (r.key === null || r.aim === null) return;
    const { hold } = r.aim;
    if (hold !== undefined && r.eased > 0) this.holdGun(r.aim, hold.line, hold.weight * r.eased);
    if (hold?.weight === 1) return; // which aimed it too
    const weight = r.aim.weight * r.eased;
    if (weight > 0) this.aimArm(r.aim, weight);
  }

  /** After the right arm aims: the left hand reaches the phaser's `supportConfig.grip`, by `support.weight` */
  tickSupport(delta: number) {
    const s = this.support;
    const on = s.on === true && this.posture !== "lie";
    s.weight = THREE.MathUtils.clamp(s.weight + (on ? delta : -delta) / supportConfig.secs, 0, 1);
    if (s.weight === 0) return;
    const gun = this.upper.bones[1]?.bone; // the right forearm, which holds it
    const [upper, fore] = this.upperLeft.bones;
    if (gun === undefined || upper === undefined || fore === undefined) return;
    s.base[0].copy(upper.bone.quaternion);
    s.base[1].copy(fore.bone.quaternion);
    gun.updateWorldMatrix(true, false);
    const at = gun.localToWorld(tmpSupport.fromArray(supportConfig.grip));
    this.reachTo("left", at, s.weight * s.weight * (3 - 2 * s.weight));
    s.wrote[0].copy(upper.bone.quaternion);
    s.wrote[1].copy(fore.bone.quaternion);
    s.written = true;
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

  /** Turns the head over its pose: a shake, then talk. Nearly always nothing to do */
  tickHead(delta: number) {
    const { entry } = this.upperHead;
    const { talking } = this;
    if ((this.headShake === null && talking.secs === 0 && talking.weight === 0) || entry === null) return;
    const { bone, base, written } = entry;
    // with no upper clip, `tickUpper` has not put the head back to its pose
    if (this.upper.key === null && this.upperLeft.key === null) {
      if (bone.quaternion.equals(written)) bone.quaternion.copy(base);
      else base.copy(bone.quaternion);
    }
    this.turnHeadShake(bone.quaternion, delta);
    this.turnHeadTalk(bone.quaternion, delta);
    written.copy(bone.quaternion);
  }

  /** Adds a shake's turn of the head to `q`, whilst one is under way */
  turnHeadShake(q: THREE.Quaternion, delta: number) {
    if (this.headShake === null) return;
    const { secs, slowing, turns, rad } = headShakeConfig;
    const p = Math.min(1, (this.headShake += delta) / secs);
    const t = 1 - (1 - p) ** slowing;
    /** Nought at either end */
    const angle = rad * Math.sin(2 * Math.PI * turns * t) * Math.sin(Math.PI * t);
    q.multiply(tmpQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, angle));
    if (p === 1) this.headShake = null;
  }

  /** Adds talk's dip and sway to `q`, eased in and out. Once the words are said, the gesture is let go */
  turnHeadTalk(q: THREE.Quaternion, delta: number) {
    const { talking } = this;
    if (talking.secs === 0 && talking.weight === 0) return;
    const { pitch, sway, hz, swayHz, easeSecs } = talkConfig;
    if (talking.secs > 0 && talking.secs <= delta) this.endGesture();
    talking.secs = Math.max(0, talking.secs - delta);
    talking.t += delta;
    const step = delta / easeSecs;
    talking.weight = THREE.MathUtils.clamp(talking.weight + (talking.secs > 0 ? step : -step), 0, 1);
    const { t, weight } = talking;
    /** Mostly downward, uneven as words are */
    const dip = 0.5 + 0.3 * Math.sin(2 * Math.PI * hz * t) + 0.2 * Math.sin(2 * Math.PI * hz * 1.7 * t + 1);
    q.multiply(tmpQuat.setFromAxisAngle(talkAxis, pitch * weight * dip));
    q.multiply(tmpQuat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, sway * weight * Math.sin(2 * Math.PI * swayHz * t)));
    this.w.r3f?.invalidate();
  }

  tickHurt(delta: number) {
    const { hurt } = this;
    if (hurt === null || onceClips.has(hurt.key) === false) return;
    const { duration } = this.npc.clips[hurt.key];
    if (this.dead === true && hurt.secs >= duration) return; // held on its last frame
    hurt.secs += delta * (hurt.rate ?? 1);
    if (hurt.secs < duration) return;
    if (hurt.next === null) return this.dead === true ? this.holdStill() : this.setHurt(null);
    this.hurt = { key: hurt.next, secs: 0, next: null };
    this.setPose(hurt.next);
    if (this.dead === true) this.holdStill();
    this.w.events.next({ key: "npc-hurt", npcKey: this.npc.key, clip: hurt.next, dead: this.dead });
  }

  /** Eases `lieLook` in or out: out once they no longer lie */
  tickLieLook(delta: number) {
    const look = this.lieLook;
    if (this.posture !== "lie") look.on = false;
    if (look.on === false && look.weight === 0) return;
    look.weight = THREE.MathUtils.clamp(look.weight + (look.on ? delta : -delta) / upperFadeSecs, 0, 1);
    if (look.weight > 0 && look.weight < 1) this.w.r3f?.invalidate(); // still on its way
  }

  /** Lit more in the player's room, eased in and out as either changes room — see `theme.npcs.sameRoom`. Never the player or the dead */
  tickRoomLit(delta: number) {
    const { roomLit, roomSlot } = this.npc;
    const lit = this.dead !== true && this.w.player?.is(this.npc.key) !== true;
    const goal = lit && roomSlot.value === this.w.npc.playerRoom ? 1 : 0;
    if (roomLit === undefined || roomLit.value === goal) return; // undefined on an npc from before hmr
    const step = (goal === 1 ? delta : -delta) / npcMaterialConfig.sameRoomSecs;
    roomLit.value = THREE.MathUtils.clamp(roomLit.value + step, 0, 1);
    this.w.r3f?.invalidate();
  }

  /** Mostly the head's, about the vertical: the torso takes a little, shared by its two bones */
  tickTurn(delta: number) {
    const { turn } = this;
    if (this.posture !== "sit" && turn.head === false) turn.target = turn.want = 0;
    this.tickTurnAim(delta);
    /** How far an arm aims them: the torso then turns with the gun, not with their look */
    const aiming = this.posture === "sit" && this.upper.aim !== null ? this.upper.eased : 0;
    /** Radians the torso turns with the gun past `aimTorsoFrom` to their left */
    const torsoAim = aiming * Math.max(0, turn.aim - sitTurn.aimTorsoFrom);
    if (turn.target === 0 && turn.value === 0 && torsoAim === 0) return void (turn.held = 0); // nearly everyone, nearly always
    const ease = 1 - Math.exp(-sitTurn.rate * delta);
    turn.value += (turn.target - turn.value) * ease;
    if (Math.abs(turn.value - turn.target) < 1e-3) turn.value = turn.target;
    else this.w.r3f?.invalidate(); // still on its way
    if (turn.value === 0 && torsoAim === 0) return void (turn.held = 0);
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
    const share = (1 - aiming) * (this.posture === "sit" ? sitTurn.body : 0) * turn.value + torsoAim;
    /** The neck's turn, were the torso to take only its share */
    const neckWant = turn.value - share;
    /** What the neck may not turn towards a hand at their head (their left is positive), which the torso takes */
    const heldWant =
      (held.left ? Math.max(0, neckWant - sitTurn.heldNeckRad) : 0) +
      (held.right ? Math.min(0, neckWant + sitTurn.heldNeckRad) : 0);
    // eased, as the hand comes and goes e.g. psi lowered
    turn.held += (heldWant - turn.held) * ease;
    if (Math.abs(turn.held - heldWant) < 1e-3) turn.held = heldWant;
    else this.w.r3f?.invalidate();
    const torso = share + turn.held;
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

  /** Slerp each arm from the pose towards its clip, by `blend` — and the head towards the left's, then the right's over it */
  tickUpper(delta: number) {
    const [l, r] = [this.upperLeft, this.upper];
    this.tickUpperSide("left", delta);
    this.tickUpperSide("right", delta);
    const { entry } = this.upperHead;
    /** Lain, their look turns the head whilst no arm aims it */
    const look = r.aim === null && this.lieLook.weight > 0 ? this.lieLook : null;
    const turned = this.headTurn.w !== 1; // still easing back from a look
    const { headAt } = this;
    if (entry === null || (l.key === null && r.key === null && look === null && headAt === null && turned === false))
      return;
    const { bone, base, written } = entry;
    if (bone.quaternion.equals(written) === false) base.copy(bone.quaternion);
    bone.quaternion.copy(base);
    for (const u of [l, r]) if (u.key !== null && u.hasHead === true) bone.quaternion.slerp(u.head, u.eased);
    for (const u of [l, r]) if (u.key !== null) bone.quaternion.premultiply(u.level);
    written.copy(bone.quaternion);
    if (r.key !== null && r.aim !== null) this.aimHead(r.aim, (r.aim.head ?? r.aim.weight) * r.eased, delta);
    else if (headAt !== null) this.aimHead(headAt, 1, delta);
    else if (look !== null) this.aimHead(look, look.weight * look.weight * (3 - 2 * look.weight), delta);
    else this.aimHead(null, 0, delta); // back to none
    for (const u of [l, r]) {
      if (u.blend !== 0 || u.target !== 0) continue;
      u.key = null; // the pose's own again
      u.aim = null;
    }
  }

  tickUpperSide(side: Side, delta: number) {
    const u = this.upperOf(side);
    if (u.key === null) return; // let go of: its blend is nought already
    const via =
      (u.past === true && this.posture === "sit" && this.isUnderTable()) ||
      (u.byWall === true && this.posture === "stand")
        ? tmpVias
        : null;
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
    // the pose's, unless its mixer left ours there — as a still pose e.g. `lie` does
    for (const { bone, base, written } of u.bones)
      if (bone.quaternion.equals(written) === false) base.copy(bone.quaternion);
    if (via !== null) setSitArmVia(u.bones, via);
    for (let i = 0; i < u.bones.length; i++) {
      const { bone, base, written, from } = u.bones[i];
      const track = tracks.get(bone.name);
      let q = track === undefined ? base : tmpQuat.fromArray(track.evaluate(u.time));
      if (track !== undefined && bone.parent?.name === "chest") q.premultiply(lean);
      if (s < 1) q = tmpSwap.slerpQuaternions(from, q, s);
      if (via === null) {
        written.copy(u.fold ? foldMix(base, q, t, bone.quaternion) : bone.quaternion.slerpQuaternions(base, q, t));
        continue;
      }
      // drawn back, and on to the clip's before it gets there: one move, with no stop.
      // That leg eases swing and twist apart, so the arm doesn't roll about its length
      const { there, onFrom } = sitArmVia;
      const b = smooth((u.blend - onFrom) / (1 - onFrom));
      splitTwist(tmpPast.slerpQuaternions(base, via[i], smooth(u.blend / there)), tmpSwingFrom, tmpTwistFrom);
      splitTwist(q, tmpSwingTo, tmpTwistTo);
      tmpSwingFrom.slerp(tmpSwingTo, b);
      tmpTwistFrom.slerp(tmpTwistTo, b);
      written.copy(bone.quaternion.multiplyQuaternions(tmpSwingFrom, tmpTwistFrom));
    }
    const head = tracks.get("head");
    u.hasHead = head !== undefined;
    if (head !== undefined) u.head.fromArray(head.evaluate(u.time)).premultiply(lean);
  }

  /** Stood, only their head turns to `at`, their body left as it is. `null` lets it go — see `tickTurn` */
  turnHeadTo(at: null | Geom.VectJson) {
    this.turn.head = at !== null;
    this.turnTo(at);
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

  upperOf(side: Side) {
    return side === "right" ? this.upper : this.upperLeft;
  }
}

function isGait(key: AnimationClipKey) {
  return key === "walk" || isRun(key);
}

/** `run_ahead` is `run` with guard arms, run-strafing */
function isRun(key: AnimationClipKey) {
  return key === "run" || key === "run_ahead";
}

/** A pose that leaves the feet apart as it ends */
function isStride(key: AnimationClipKey) {
  return isGait(key) || key === "backwards" || (shuffleStepClipKeys as AnimationClipKey[]).includes(key);
}

/** Whether a clip has them sat, lain or stood: `sit` and `lie`, and the hurt clips and fidgets of each */
export function postureOf(key: AnimationClipKey) {
  return key === "sit" || (key.startsWith("sit_") && key !== "sit_reach")
    ? "sit"
    : key === "lie" || key.startsWith("lie_")
      ? "lie"
      : "stand";
}

type PostureKey = ReturnType<typeof postureOf>;

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
const onceClips = new Set<AnimationClipKey>([
  ...Object.values(hitConfig.clips).flatMap((byRegion) => Object.values(byRegion).filter((key) => !isPacified(key))),
  hitConfig.sink,
  ...dieClips,
  ...riseClips,
]);

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
/** As `strafeClipKeys`, crouched half or full */
const halfCrouchStrafeClipKeys = [
  "crouch_half_walk",
  "crouch_half_strafe_right",
  "crouch_half_backwards",
  "crouch_half_strafe_left",
] satisfies AnimationClipKey[];
const crouchStrafeClipKeys = [
  "crouch_walk",
  "crouch_strafe_right",
  "crouch_backwards",
  "crouch_strafe_left",
] satisfies AnimationClipKey[];
/** As `strafeClipKeys`, running */
const runStrafeClipKeys = [
  "run_ahead",
  "run_strafe_right",
  "run_backwards",
  "run_strafe_left",
] satisfies AnimationClipKey[];
/** As `strafeClipKeys`, a short move's subtle steps — see `startShuffle` */
const shuffleStepClipKeys = [
  "shuffle_step",
  "shuffle_step_right",
  "shuffle_step_back",
  "shuffle_step_left",
] satisfies AnimationClipKey[];
/** Each blend, by crouch level */
const gaitSets = [strafeClipKeys, halfCrouchStrafeClipKeys, crouchStrafeClipKeys] as const;
/** Every blend, running and shuffling too */
const strafeSets = [...gaitSets, runStrafeClipKeys, shuffleStepClipKeys] as const;
type GaitKey = (typeof strafeSets)[number][number];
/** What they rest in, by crouch level */
const crouchIdleKeys = [defaultIdleAnimationClipKey, "crouch_half", "crouch_cover"] as const;
type CrouchLevel = 0 | 1 | 2;
type CrouchGaitKey = (typeof gaitSets)[1 | 2][number];
const crouchGaitKeys = new Set<AnimationClipKey>([...halfCrouchStrafeClipKeys, ...crouchStrafeClipKeys]);
const isCrouchGait = (key: AnimationClipKey): key is CrouchGaitKey => crouchGaitKeys.has(key);
/** Metres a second a crouched gait is paced at, however slowly they creep */
const crouchPaceMin = 0.2;
/** The way `(dx, dz)` heads, relative to a facing of `rotationY`: `0` ahead, `π/2` to their right */
function headingOf(rotationY: number, dx: number, dz: number) {
  const [sin, cos] = [Math.sin(rotationY), Math.cos(rotationY)];
  return Math.atan2(dx * cos - dz * sin, -dx * sin - dz * cos);
}

/** The weight of the `i`th of four directional gaits, clockwise from ahead, for `heading` */
function gaitWeight(heading: number, i: number) {
  return Math.max(0, 1 - Math.abs(deltaAngle(heading, (i * Math.PI) / 2)) / (Math.PI / 2));
}

/** Metres a second a shuffle is paced at as it stops, so its steps barely move */
const shufflePaceMin = 0.02;

const upperTracks = new WeakMap<
  THREE.AnimationClip,
  { tracks: Map<string, THREE.Interpolant>; torso: THREE.Interpolant[]; adds: boolean }
>();
/** Clips whose stomach and chest keys are ADDED to the pose's torso, moving it. Any other's only say how its arms lean */
const upperAddsTorso = new Set<string>(["sit_reach"]);
/** The chest stays the pose's, though its lean is the clip's — see `tickUpper` */
const upperBodyBones = ["head", "rightarm", "rightforearm", "leftarm", "leftforearm"];

/** Seconds at least a shuffle's upper body takes to hand back, as a fade of nought pops */
const minFadeSecs = 0.05;
/** The bones above the hips, which a shuffle leaves to the rest clip */
const restUpperBones = new Set([...upperBodyBones, "stomach", "chest"]);
/** A clip's tracks for `restUpperBones` alone, cached per clip */
const upperClips = new WeakMap<THREE.AnimationClip, THREE.AnimationClip>();
function upperOf(clip: THREE.AnimationClip) {
  let upper = upperClips.get(clip);
  if (upper === undefined) {
    const tracks = clip.tracks.filter((t) => restUpperBones.has(THREE.PropertyBinding.parseTrackName(t.name).nodeName));
    upperClips.set(clip, (upper = new THREE.AnimationClip(`${clip.name}--upper`, clip.duration, tracks)));
  }
  return upper;
}

export type Side = "left" | "right";
const sides = ["left", "right"] as const;
/** Which hands are at their head, this tick — see `tickTurn` */
const held = { left: false, right: false };

/** Smoothstep, held outside `0` to `1` */
const smooth = (x: number) => THREE.MathUtils.smoothstep(x, 0, 1);
/** `q` as `swing * twist`, the twist being its turn about the bone's own length, local y for an arm */
function splitTwist(q: THREE.Quaternion, swing: THREE.Quaternion, twist: THREE.Quaternion) {
  twist.set(0, q.y, 0, q.w);
  if (twist.lengthSq() < 1e-12) twist.identity();
  else twist.normalize();
  swing.copy(q).multiply(tmpUntwist.copy(twist).invert());
}

/** `from` to `to` by `XZY` Euler angles: the elbow bends, then the forearm swings in, so the hand never swings out */
function foldMix(from: THREE.Quaternion, to: THREE.Quaternion, t: number, out: THREE.Quaternion) {
  const [a, b] = [tmpFoldFrom.setFromQuaternion(from, "XZY"), tmpFoldTo.setFromQuaternion(to, "XZY")];
  const mix = (x: number, y: number) =>
    x + (THREE.MathUtils.euclideanModulo(y - x + Math.PI, 2 * Math.PI) - Math.PI) * t;
  return out.setFromEuler(a.set(mix(a.x, b.x), mix(a.y, b.y), mix(a.z, b.z), "XZY"));
}

/** Writes the pose drawn back from the arm's: its elbow back along the forearm's line, the forearm pointed as before */
function setSitArmVia([arm, forearm]: UpperBone[], [toArm, toForearm]: THREE.Quaternion[]) {
  const elbow = tmpElbow.copy(forearm.bone.position).applyQuaternion(arm.base);
  const along = tmpForearmDir.set(0, -1, 0).applyQuaternion(forearm.base).applyQuaternion(arm.base);
  const back = tmpDrawn
    .copy(elbow)
    .addScaledVector(along, -sitArmVia.back * elbow.length())
    .normalize();
  toArm.setFromUnitVectors(elbow.normalize(), back).multiply(arm.base);
  toForearm.copy(toArm).invert().multiply(arm.base).multiply(forearm.base);
}
/** A phaser hit: the part met, where and which way, and its outcome */
export type HitImpact = { part: string; at: THREE.Vector3; dir: THREE.Vector3; outcome: HitOutcome };

/** A shot that hits: they recover, are put down, or die */
export type HitOutcome = Extract<JshCli.ShotOutcome, "hit" | "down" | "kill">;

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
  /** Stood by a wall, likewise */
  byWall: false,
  /** Blended by `foldMix` rather than a slerp */
  fold: false,
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
/** The head bone's side axis, which it dips about as they speak */
const talkAxis = new THREE.Vector3(1, 0, 0);
/** An arm bone's swing and twist, from and via and to — see `splitTwist` */
const tmpSwingFrom = new THREE.Quaternion();
const tmpFoldFrom = new THREE.Euler();
const tmpFoldTo = new THREE.Euler();
const tmpTwistFrom = new THREE.Quaternion();
const tmpSwingTo = new THREE.Quaternion();
const tmpTwistTo = new THREE.Quaternion();
const tmpUntwist = new THREE.Quaternion();
/** The arm and forearm drawn back, and a bone on its way there — see `setSitArmVia` */
const tmpVias = [new THREE.Quaternion(), new THREE.Quaternion()];
const tmpPast = new THREE.Quaternion();
const tmpElbow = new THREE.Vector3();
const tmpForearmDir = new THREE.Vector3();
const tmpDrawn = new THREE.Vector3();
const tmpSwap = new THREE.Quaternion();
const tmpLean = new THREE.Quaternion();
const tmpShoulder = new THREE.Vector3();
const tmpAlong = new THREE.Vector3();
const tmpWant = new THREE.Vector3();
const tmpFrom = new THREE.Vector3();
const tmpAxis = new THREE.Vector3();
const tmpTip = new THREE.Vector3();
const tmpPole = new THREE.Vector3();
const tmpMuzzle = new THREE.Vector3();
const tmpToChest = new THREE.Matrix4();
const tmpOrigin = new THREE.Vector3();
const tmpUpper = new THREE.Vector3();
const tmpForeQuat = new THREE.Quaternion();
const tmpInverse = new THREE.Quaternion();
const tmpPart = new THREE.Quaternion();
const tmpDir = new THREE.Vector3();
const tmpToAt = new THREE.Vector3();
const tmpAlign = new THREE.Quaternion();
const tmpHeld = { left: new THREE.Vector3(), right: new THREE.Vector3() };
const tmpSupport = new THREE.Vector3();

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

/** Poses at rest whose clip is one breath: empty at `0` and full halfway, whatever its length. Fidgets breathe as their base */
const breathClips = new Set<AnimationClipKey>([
  "idle",
  "breathe",
  "sit",
  "lie",
  "lie_left",
  "lie_right",
  ...fidgetClipKeys,
]);

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
  /** Stood, the line its muzzle is held on, by `weight` — see `holdGun` */
  hold?: { line: THREE.Ray; weight: number };
};

function keyOf(clip: THREE.AnimationClip) {
  return clip.name as AnimationClipKey;
}

function bubbleHeightForClip(clipName: AnimationClipKey): number {
  const posture = postureOf(clipName);
  if (isHalfCrouch(clipName)) return 1.75;
  if (posture === "sit" || isLowClip(clipName)) return 1.4;
  if (posture === "lie") return 0.9;
  return 2;
}

/** Stood, yet about as low as one sat: collapsed on the floor, or crouched */
const isCrouch = (clipName: AnimationClipKey) => clipName.startsWith("crouch");
const isLowClip = (clipName: AnimationClipKey) => clipName.startsWith("collapsed") || isCrouch(clipName);
/** Crouched half: the head lower than stood, higher than sat */
const isHalfCrouch = (clipName: AnimationClipKey) => clipName.startsWith("crouch_half");

/** The highest a label is lifted, standing — see `boundAnyPose` */
export const labelYShiftMax = 2.2;

function labelYShiftForClip(clipName: AnimationClipKey): number {
  const posture = postureOf(clipName);
  if (isHalfCrouch(clipName)) return 1.95;
  if (posture === "sit" || isLowClip(clipName)) return 1.6;
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
