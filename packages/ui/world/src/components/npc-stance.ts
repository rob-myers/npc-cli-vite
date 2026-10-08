import * as THREE from "three/webgpu";
import { npcScale, stanceConfig } from "../const.npc";

/**
 * Keeps an npc's feet where they stopped, roughly, whatever gait brought them there. The standing
 * pose has them side by side. This holds the planted foot in place and the other near where it was,
 * solves each leg to reach, and sinks the hips to let them.
 *
 * Positions are on the GROUND: in the npc's own frame, `x` to its side, `y` up and `z` behind it.
 */
export const newStance = () => ({
  /** There are feet to hold. Whilst `false`, `tickStance` is not called */
  held: false,
  /** Still easing in from where the feet stopped. The gait plays on as it fades, so the pose is not followed */
  settling: false,
  /** How far the hold is in, `0` to `1` */
  weight: 0,
  group: null as null | THREE.Object3D,
  /** Left, then right. Empty if the model lacks a bone */
  legs: [] as Leg[],
  /** Which of `legs` was planted as they stopped. It stays put, and the other is placed from it */
  planted: 0,
  /** The legs' parent, sunk so they reach */
  root: null as null | { bone: THREE.Object3D; base: THREE.Vector3; written: THREE.Vector3 },
  /** How far the hips are moved over the feet, so the legs do not slant */
  shiftX: 0,
  shiftZ: 0,
  /** Where they stood as they stopped, in the world. They slide on a little, and the feet do not */
  stoodX: 0,
  stoodZ: 0,
});
export type Stance = ReturnType<typeof newStance>;

/** Where an npc stands, and its facing */
type Body = { position: { x: number; z: number }; rotation: { y: number } };

/** A bone the mixer also writes. `base` is the pose's value, `written` ours, so the two are told apart */
type Held = { bone: THREE.Object3D; base: THREE.Quaternion; written: THREE.Quaternion };

type Leg = {
  thigh: Held;
  shin: Held;
  foot: Held;
  /** The pose's ankle from its hip: `x` sideways, then the thigh's and the shin's reach down (`u`) and back (`v`) */
  x: number;
  u1: number;
  v1: number;
  u2: number;
  v2: number;
  /** The pose's ankle on the ground */
  poseX: number;
  poseY: number;
  poseZ: number;
  /** Where the ankle was as they stopped, on the ground */
  stopX: number;
  stopY: number;
  stopZ: number;
  /** How far from the pose's place the ankle is held */
  offX: number;
  offZ: number;
  /** Where the ankle is held this frame, from its hip */
  toX: number;
  toU: number;
  toV: number;
  /** The furthest its ankle may be from its hip: the pose's own distance, if that is straighter */
  reach: number;
};

const held = (bone?: THREE.Object3D): null | Held =>
  bone === undefined ? null : { bone, base: new THREE.Quaternion(), written: new THREE.Quaternion(Number.NaN) };

const newLeg = (thigh: Held, shin: Held, foot: Held): Leg => ({
  ...{ thigh, shin, foot, x: 0, u1: 0, v1: 0, u2: 0, v2: 0, poseX: 0, poseY: 0, poseZ: 0 },
  ...{ stopX: 0, stopY: 0, stopZ: 0, offX: 0, offZ: 0, toX: 0, toU: 0, toV: 0, reach: 0 },
});

function bind(stance: Stance, group: THREE.Object3D) {
  stance.group = group;
  stance.legs = ["left", "right"].flatMap((side) => {
    const [thigh, shin, foot] = ["thigh", "shin", "foot"].map((part) => held(group.getObjectByName(side + part)));
    return thigh && shin && foot ? newLeg(thigh, shin, foot) : [];
  });
  const bone = stance.legs[0]?.thigh.bone.parent;
  stance.root = bone == null ? null : { bone, base: new THREE.Vector3(), written: new THREE.Vector3(Number.NaN) };
}

/** Notes the pose's value of a bone, where the mixer has written over ours */
function sync(part: Held) {
  if (part.bone.quaternion.equals(part.written) === false) part.base.copy(part.bone.quaternion);
}

/**
 * Measures a leg from the given rotations of its thigh and shin, and finds its ankle on the ground.
 * `rootPos` is the hips' place. They pitch by the angle whose cosine and sine are given.
 */
function measure(
  leg: Leg,
  thigh: THREE.Quaternion,
  shin: THREE.Quaternion,
  rootPos: THREE.Vector3,
  cos: number,
  sin: number,
) {
  const knee = tmpKnee.copy(leg.shin.bone.position).applyQuaternion(thigh);
  const lower = tmpLower.copy(leg.foot.bone.position).applyQuaternion(shin).applyQuaternion(thigh);
  leg.x = knee.x + lower.x;
  leg.u1 = -knee.y;
  leg.v1 = knee.z;
  leg.u2 = -lower.y;
  leg.v2 = lower.z;
  const hip = leg.thigh.bone.position;
  const y = hip.y - leg.u1 - leg.u2;
  const z = hip.z + leg.v1 + leg.v2;
  leg.poseX = rootPos.x + hip.x + leg.x;
  leg.poseY = rootPos.y + y * cos - z * sin;
  leg.poseZ = rootPos.z + y * sin + z * cos;
}

/** The hips pitch about their own sideways axis alone. Returns its cosine as `x` and its sine as `y` */
function pitchOf(root: THREE.Object3D) {
  const angle = 2 * Math.atan2(root.quaternion.x, root.quaternion.w);
  return tmpPitch.set(Math.cos(angle), Math.sin(angle));
}

/** Shortens `(x, z)` to `max` at most. Returns it as `tmpOff` */
function capped(x: number, z: number, max: number) {
  const length = Math.hypot(x, z);
  return tmpOff.set(x, z).multiplyScalar(length > max ? max / length : 1);
}

/** Call as a moving pose ends, before the pose changes. Reads where the feet are */
export function takeStance(stance: Stance, group: THREE.Object3D, body: Body) {
  if (stance.group !== group) bind(stance, group);
  const { legs, root } = stance;
  if (root === null || legs.length < 2) return;
  const { x: cos, y: sin } = pitchOf(root.bone);
  for (const leg of legs) {
    measure(leg, leg.thigh.bone.quaternion, leg.shin.bone.quaternion, root.bone.position, cos, sin);
    leg.stopX = leg.poseX;
    leg.stopY = leg.poseY;
    leg.stopZ = leg.poseZ;
  }
  // the lower foot bears their weight. Level, it is the one ahead
  const [left, right] = legs;
  const level = Math.abs(left.stopY - right.stopY) < stanceConfig.level;
  stance.planted = (level ? left.stopZ < right.stopZ : left.stopY < right.stopY) ? 0 : 1;
  stance.stoodX = body.position.x;
  stance.stoodZ = body.position.z;
  // eased in afresh from where the feet are now, even if an earlier hold was still easing out
  stance.weight = 0;
  stance.settling = true;
  stance.held = true;
}

/** Call each frame after the mixer, whilst `stance.held`. `on` is whether they stand still */
export function tickStance(stance: Stance, group: THREE.Object3D, on: boolean, delta: number, body: Body) {
  if (stance.group !== group) bind(stance, group);
  const { legs, root, settling } = stance;
  if (root === null || legs.length < 2) return void (stance.held = false);
  const { keep, maxSplit, maxOff, minOff, maxShift, maxLean, fadeSecs } = stanceConfig;
  const step = delta / fadeSecs;
  const weight = (stance.weight = THREE.MathUtils.clamp(stance.weight + (on ? step : -step), 0, 1));
  const eased = weight * weight * (3 - 2 * weight);

  if (root.bone.position.equals(root.written) === false) root.base.copy(root.bone.position);
  const { x: cos, y: sin } = pitchOf(root.bone);
  for (const leg of legs) {
    sync(leg.thigh);
    sync(leg.shin);
    sync(leg.foot);
    measure(leg, leg.thigh.base, leg.shin.base, root.base, cos, sin);
  }

  /** How far they have slid sideways and backwards since they stopped, in the model's metres */
  let slidX = 0;
  let slidZ = 0;
  if (settling === true) {
    const dx = body.position.x - stance.stoodX;
    const dz = body.position.z - stance.stoodZ;
    const c = Math.cos(body.rotation.y);
    const s = Math.sin(body.rotation.y);
    slidX = (dx * c - dz * s) / npcScale;
    slidZ = (dx * s + dz * c) / npcScale;
    // the planted foot stays where it stopped, though no further from the pose's place than `maxOff`
    const planted = legs[stance.planted];
    const other = legs[1 - stance.planted];
    const stay = capped(planted.stopX - slidX - planted.poseX, planted.stopZ - slidZ - planted.poseZ, maxOff);
    planted.offX = stay.x;
    planted.offZ = stay.y;
    // the other keeps `keep` of how far it was from that one, beyond how far apart the pose has them
    const apart = capped(
      (other.stopX - planted.stopX - other.poseX + planted.poseX) * keep,
      (other.stopZ - planted.stopZ - other.poseZ + planted.poseZ) * keep,
      maxSplit,
    );
    const placed = capped(planted.offX + apart.x, planted.offZ + apart.y, maxOff);
    other.offX = placed.x;
    other.offZ = placed.y;
    // feet both off to one side of the pose's would slant the legs. The hips go over them, up to `maxShift`
    const midX = (planted.offX + other.offX) / 2;
    const midZ = (planted.offZ + other.offZ) / 2;
    const shift = capped(midX, midZ, maxShift);
    stance.shiftX = shift.x;
    stance.shiftZ = shift.y;
    // what slant is left over `maxLean`, the feet make up
    const lean = capped(midX - stance.shiftX, midZ - stance.shiftZ, maxLean);
    const stepX = midX - stance.shiftX - lean.x;
    const stepZ = midZ - stance.shiftZ - lean.y;
    for (const leg of legs) {
      leg.offX -= stepX;
      leg.offZ -= stepZ;
    }
  }
  /** Where the hips are, moved over the feet */
  const hipsX = root.base.x + stance.shiftX * eased;
  const hipsZ = root.base.z + stance.shiftZ * eased;

  // where each ankle is held from its hip, and how far the hips must sink for the longer leg to reach
  let sink = 0;
  for (const leg of legs) {
    let x = leg.poseX + leg.offX * eased;
    let y = leg.poseY;
    let z = leg.poseZ + leg.offZ * eased;
    if (settling === true) {
      // eased from where the foot stopped on the ground, to where it is held
      x = THREE.MathUtils.lerp(leg.stopX - slidX, leg.poseX + leg.offX, eased);
      y = THREE.MathUtils.lerp(leg.stopY, leg.poseY, eased);
      z = THREE.MathUtils.lerp(leg.stopZ - slidZ, leg.poseZ + leg.offZ, eased);
    }
    const hip = leg.thigh.bone.position;
    const up = y - root.base.y;
    const back = z - hipsZ;
    leg.toX = x - hipsX - hip.x;
    leg.toU = hip.y - (up * cos + back * sin);
    leg.toV = back * cos - up * sin - hip.z;
    const straight = (Math.hypot(leg.u1, leg.v1) + Math.hypot(leg.u2, leg.v2)) * straightest;
    leg.reach = Math.max(straight, Math.hypot(leg.u1 + leg.u2, leg.v1 + leg.v2));
    const room = leg.reach * leg.reach - leg.toV * leg.toV - leg.toX * leg.toX + leg.x * leg.x;
    sink = Math.max(sink, leg.toU - Math.sqrt(Math.max(0, room)));
  }
  root.written.copy(root.bone.position.set(hipsX, root.base.y - sink, hipsZ));

  for (const leg of legs) {
    const { thigh, shin, foot } = leg;
    const l1 = Math.hypot(leg.u1, leg.v1);
    const l2 = Math.hypot(leg.u2, leg.v2);
    const down = leg.toU - sink;
    // the leg is solved side on, then tipped about its hip to bring the ankle across
    const flat = Math.sqrt(Math.max(1e-6, leg.toX * leg.toX + down * down - leg.x * leg.x));
    const tip = tmpTip.setFromAxisAngle(backwards, Math.atan2(leg.toX, down) - Math.atan2(leg.x, flat));
    const far = THREE.MathUtils.clamp(Math.hypot(flat, leg.toV), Math.abs(l1 - l2), leg.reach);
    const bend = Math.acos(THREE.MathUtils.clamp((far * far - l1 * l1 - l2 * l2) / (2 * l1 * l2), -1, 1));
    const upper = Math.atan2(leg.toV, flat) - Math.atan2(l2 * Math.sin(bend), l1 + l2 * Math.cos(bend));
    // each segment turns about the hip's own sideways axis by the change in its angle
    const turn1 = tmpTurn1.setFromAxisAngle(sideways, Math.atan2(leg.v1, leg.u1) - upper).premultiply(tip);
    const turn2 = tmpTurn2.setFromAxisAngle(sideways, Math.atan2(leg.v2, leg.u2) - upper - bend).premultiply(tip);
    /** The shin's rotation from the hip, in the pose */
    const lower = tmpQuat.copy(thigh.base).multiply(shin.base);
    /** ...and where it goes */
    const shinTo = tmpShin.copy(turn2).multiply(lower);
    thigh.written.copy(thigh.bone.quaternion.copy(turn1).multiply(thigh.base));
    shin.written.copy(shin.bone.quaternion.copy(thigh.written).invert().multiply(shinTo));
    // the foot keeps the pose's own tilt, so the sole stays flat
    foot.written.copy(foot.bone.quaternion.copy(shinTo).invert().multiply(lower).multiply(foot.base));
  }

  if (settling === true && (on === false || weight === 1)) {
    stance.settling = false;
    // cut short, the hold is let go: its offsets were never reached, so easing back to them would jump
    if (weight < 1) return letGo(stance);
    // feet that stopped where the pose has them need no holding
    if (legs.every((leg) => Math.hypot(leg.offX, leg.offZ) < minOff)) return letGo(stance);
  }
  if (on === false && weight === 0) letGo(stance);
}

/** Ends the hold, and puts back the pose's own legs and hips: a still pose would not write over ours */
function letGo(stance: Stance) {
  stance.held = false;
  for (const { thigh, shin, foot } of stance.legs) {
    for (const part of [thigh, shin, foot]) part.written.copy(part.bone.quaternion.copy(part.base));
  }
  const { root } = stance;
  if (root !== null) root.written.copy(root.bone.position.copy(root.base));
}

/** A leg is not asked to go straighter than this share of its length, where its solution turns sharply */
const straightest = 0.998;
const sideways = new THREE.Vector3(1, 0, 0);
const backwards = new THREE.Vector3(0, 0, 1);
const tmpKnee = new THREE.Vector3();
const tmpLower = new THREE.Vector3();
const tmpPitch = new THREE.Vector2();
const tmpOff = new THREE.Vector2();
const tmpQuat = new THREE.Quaternion();
const tmpShin = new THREE.Quaternion();
const tmpTip = new THREE.Quaternion();
const tmpTurn1 = new THREE.Quaternion();
const tmpTurn2 = new THREE.Quaternion();
