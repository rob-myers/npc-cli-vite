import * as THREE from "three/webgpu";
import { type FlinchTune, flinchConfig } from "../const.npc";
import type { NpcAnimation } from "./npc-animation";

/** A jolt from a shot, easing out. A hit's holds `level` of its `tune.hold` whilst they are hurt, eased over `tune.secs` */
export type Flinch = { secs: number; bones: FlinchBone[]; tune: FlinchTune; level: number };

/** A shot landing `at` along `dir` jolts `part`, and the bones it hangs from, away from it */
export function flinch(
  anim: NpcAnimation,
  part: null | string,
  at: THREE.Vector3,
  dir: THREE.Vector3,
  tune = flinchConfig,
) {
  const group = anim.npc.group;
  if (group === null) return;
  undoFlinch(anim); // else what it last wrote stays
  const { rad, falloff } = tune;
  let bone = group.getObjectByName(part !== null && flinchBones.has(part) ? part : "stomach") ?? null;
  const bones: FlinchBone[] = [];
  for (let weight = 1; bone !== null && flinchBones.has(bone.name); bone = bone.parent, weight *= falloff) {
    // an arm turns `arms` as far, and what it hangs from falls off from that
    if (armBones.has(bone.name)) weight = Math.min(weight, tune.arms ?? 1);
    if (weight === 0) break;
    bone.updateWorldMatrix(true, false);
    const axis = new THREE.Vector3().crossVectors(tmpLever.subVectors(at, bone.getWorldPosition(tmpPivot)), dir);
    if (axis.lengthSq() < 1e-8) continue;
    const parent = bone.parent?.getWorldQuaternion(tmpParentQuat).invert() ?? tmpParentQuat.identity();
    const [before, written] = [new THREE.Quaternion(), new THREE.Quaternion(Number.NaN)];
    bones.push({ bone, axis: axis.normalize().applyQuaternion(parent), rad: rad * weight, before, written });
  }
  const level = anim.flinchAt?.level ?? 0; // a hold under way carries on
  anim.flinchAt = bones.length === 0 ? null : { secs: 0, bones, tune, level };
  anim.w.r3f?.invalidate();
}

export function tickFlinch(anim: NpcAnimation, delta: number) {
  const f = anim.flinchAt;
  if (f == null) return;
  const tune = f.tune ?? flinchConfig;
  const { hold = 0 } = tune;
  const holding = hold > 0 && anim.hurt !== null && anim.dead !== true;
  f.level = THREE.MathUtils.clamp((f.level ?? 0) + (holding ? delta : -delta) / tune.secs, 0, 1);
  if ((f.secs += delta) >= tune.secs && f.level === 0) return void (anim.flinchAt = null); // undone already, this tick
  const u = f.secs / tune.peakSecs;
  /** `1` at `peakSecs`, easing back after, but never below the hold */
  const k = Math.max(f.secs < tune.secs ? u * Math.exp(1 - u) : 0, hold * f.level);
  for (const b of f.bones) {
    b.before.copy(b.bone.quaternion);
    b.written.copy(b.bone.quaternion.premultiply(tmpQuat.setFromAxisAngle(b.axis, b.rad * k)));
  }
  anim.w.r3f?.invalidate();
}

/** Puts back what the flinch last wrote, unless something has written over it since */
export function undoFlinch(anim: NpcAnimation) {
  const bones = anim.flinchAt?.bones;
  if (bones === undefined) return; // nearly always
  for (const { bone, before, written } of bones) if (bone.quaternion.equals(written)) bone.quaternion.copy(before);
}

/** A bone a flinch turns, about `axis` in its parent's frame, and what it was before and after — see `flinch` */
type FlinchBone = {
  bone: THREE.Object3D;
  axis: THREE.Vector3;
  rad: number;
  before: THREE.Quaternion;
  written: THREE.Quaternion;
};

const armBones = new Set(["leftarm", "leftforearm", "rightarm", "rightforearm"]);

/** Bones a flinch turns: the hips and legs stay, so the feet do */
const flinchBones = new Set(["head", "chest", "stomach", "leftarm", "leftforearm", "rightarm", "rightforearm"]);

const tmpLever = new THREE.Vector3();
const tmpParentQuat = new THREE.Quaternion();
const tmpPivot = new THREE.Vector3();
const tmpQuat = new THREE.Quaternion();
