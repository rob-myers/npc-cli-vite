import * as THREE from "three/webgpu";
import { corpseConfig, stepFlinchConfig } from "../const.npc";
import { corpseParts, toBody, upRamp } from "../service/corpse-body";
import { bodyPart } from "../service/phaser-beam";
import { corpseColliderKey } from "../service/physics-bijection";
import type { NpcAnimation } from "./npc-animation";
import { flinch } from "./npc-flinch";

/**
 * Over a corpse, each foot lifts whilst over their body, whilst `on` holds its npcKey.
 * See "Walking over a corpse" in `docs/deaths.md`.
 */
export const newOverBody = () => ({
  on: new Set<string>(),
  /** The group its bones were found in, its thigh's length in metres, and what it writes */
  of: null as null | THREE.Object3D,
  thigh: 0,
  legs: [] as (Written<THREE.Quaternion> & { turn: number })[],
  /** Each foot's box, left then right, in its own frame */
  soles: [] as THREE.Box3[],
  root: null as null | Written<THREE.Vector3>,
  /** Metres their root is raised, eased: with both feet on a body they stand on it */
  rise: 0,
  /** Whether each foot, left then right, is planted on a body: one landing there jolts it */
  planted: [false, false],
  written: false,
});

export type OverBody = ReturnType<typeof newOverBody>;

/** Removes a corpse's sensor. That fires no exits, so whoever was on it is let off here */
export function removeCorpseCollider(anim: NpcAnimation) {
  if (anim.fall?.body == null) return;
  anim.fall.body = null;
  const colliders = [{ type: "rect" as const, colliderKey: corpseColliderKey(anim.npc.key) }];
  anim.w.physics.worker.postMessage({ type: "remove-physics-colliders", colliders } satisfies WW.MsgToWorker);
  for (const other of Object.values(anim.w.npc.npc)) other.anim.overBody?.on.delete(anim.npc.key);
}

/**
 * Lifts each foot over a body by bending its knee. Their root rises towards the lower foot's lift, eased both
 * ways, so they stand on it. Running, towards the higher, so they rise over it
 */
export function tickOverBody(o: OverBody, anim: NpcAnimation, delta: number) {
  const on = o.on.size > 0 && anim.dead !== true && anim.posture === "stand";
  if (on === false && o.rise === 0) return;
  const { group } = anim.npc;
  if (group === null || findBones(o, anim, group) === false) return;
  group.updateWorldMatrix(true, true);
  const lifts = on ? [o.legs[2].bone, o.legs[5].bone].map((foot, i) => footLift(o, anim, foot, i)) : [0, 0];
  const step = delta * corpseConfig.speed;
  const goal =
    anim.hurry === true && anim.moving === true ? Math.max(lifts[0], lifts[1]) : Math.min(lifts[0], lifts[1]);
  const rise = (o.rise = THREE.MathUtils.clamp(goal, o.rise - step, o.rise + step));
  if (rise === 0 && lifts[0] === 0 && lifts[1] === 0) return;
  if (rise > 0 && o.root !== null) {
    const { bone, base, wrote } = o.root;
    base.copy(bone.position);
    bone.position.y += rise / (bone.parent?.getWorldScale(tmpScale).y ?? 1);
    wrote.copy(bone.position);
  }
  o.legs.forEach((leg, i) => {
    /** The thigh turns forward by `a`, the shin back twice as far, and the foot forward again, so it stays level */
    const a = Math.acos(Math.max(-1, 1 - Math.max(0, lifts[i < 3 ? 0 : 1] - rise) / (2 * o.thigh)));
    leg.base.copy(leg.bone.quaternion);
    leg.wrote.copy(leg.bone.quaternion.premultiply(tmpQuat.setFromAxisAngle(xAxis, leg.turn * a)));
  });
  o.written = true;
}

/** Puts back what `tickOverBody` last wrote, unless something has written over it since */
export function undoOverBody(o: OverBody) {
  if (o.written === false) return;
  for (const { bone, base, wrote } of o.legs) if (bone.quaternion.equals(wrote)) bone.quaternion.copy(base);
  if (o.root?.bone.position.equals(o.root.wrote) === true) o.root.bone.position.copy(o.root.base);
  o.written = false;
}

/** Finds their legs, soles and root once per group, and measures a thigh. `false` if any is missing */
function findBones(o: OverBody, anim: NpcAnimation, group: THREE.Object3D) {
  if (o.of === group) return o.thigh > 0;
  Object.assign(o, { of: group, thigh: 0, legs: [], soles: [], root: null });
  for (const side of ["left", "right"])
    for (const [part, turn] of legTurns) {
      const bone = group.getObjectByName(side + part);
      if (bone === undefined) return false;
      o.legs.push({ bone, turn, base: new THREE.Quaternion(), wrote: new THREE.Quaternion(Number.NaN) });
    }
  for (const side of ["left", "right"]) {
    const sole = bodyPart(anim.npc, `${side}foot`)?.box;
    if (sole === undefined) return false;
    o.soles.push(sole);
  }
  const root = group.getObjectByName("hips")?.parent;
  if (root == null) return false;
  o.root = { bone: root, base: new THREE.Vector3(), wrote: new THREE.Vector3(Number.NaN) };
  const [thigh, shin] = [o.legs[0].bone, o.legs[1].bone];
  thigh.updateWorldMatrix(true, true);
  o.thigh = thigh.getWorldPosition(tmpCorner).distanceTo(shin.getWorldPosition(tmpScale));
  return o.thigh > 0;
}

/**
 * Metres `foot` lifts so the middle of its sole clears a body under it by `clear`, up its ramp.
 * Planted there, as its pose has it, after not, the body is jolted
 */
function footLift(o: OverBody, anim: NpcAnimation, foot: THREE.Object3D, i: number) {
  const sole = o.soles[i];
  const p = sole.getCenter(tmpCorner).setY(sole.min.y).applyMatrix4(foot.matrixWorld);
  let [most, under] = [0, null as null | NpcAnimation];
  for (const key of o.on) {
    const other = anim.w.npc.npc[key]?.anim;
    const body = other?.fall?.body;
    if (other === undefined || body == null) continue;
    const up = upRamp(body.hull, toBody(p.x - body.x, p.z - body.z, body.ry, tmpPoint));
    if (up > 0) under = other;
    most = Math.max(most, up * (body.top + corpseConfig.clear) - p.y);
  }
  const planted = under !== null && p.y < plantedBelow;
  if (under !== null && planted && o.planted[i] === false) jolt(under, p, anim.npc.key);
  o.planted[i] = planted;
  return most;
}

/** A foot of `by`'s landing `at` on a corpse jolts it, by the part nearest, and is heard (`corpse-stepped`) */
function jolt(corpse: NpcAnimation, at: THREE.Vector3, by: string) {
  let [part, nearest] = [null as null | string, Infinity];
  for (const name of corpseParts) {
    const bone = corpse.npc.group?.getObjectByName(name);
    const d = bone?.getWorldPosition(tmpPivot).distanceToSquared(at) ?? Infinity;
    if (d < nearest) [part, nearest] = [name, d];
  }
  flinch(corpse, part, at, down, stepFlinchConfig);
  corpse.w.events.next({ key: "corpse-stepped", npcKey: by });
}

type Written<T> = { bone: THREE.Object3D; base: T; wrote: T };

/** Each leg bone's turn about `x`, in `a`. Their front is `-z`, so forward is positive */
const legTurns = [
  ["thigh", 1],
  ["shin", -2],
  ["foot", 1],
] as const;

/** Metres up a sole may be, as its pose has it, and be planted */
const plantedBelow = 0.03;

const down = new THREE.Vector3(0, -1, 0);
const tmpCorner = new THREE.Vector3();
const tmpPivot = new THREE.Vector3();
const tmpPoint = new THREE.Vector2();
const tmpQuat = new THREE.Quaternion();
const tmpScale = new THREE.Vector3();
const xAxis = new THREE.Vector3(1, 0, 0);
