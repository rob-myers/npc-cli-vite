import * as THREE from "three/webgpu";
import { npcDims } from "../const.both";
import { deathConfig, hitConfig, mirroredClips } from "../const.npc";
import { bodyCrosses } from "../service/corpse-body";
import type { AnimationClipKey } from "./NPCs";
import type { Npc } from "./npc";
import type { NpcAnimation } from "./npc-animation";
import { removeCorpseCollider } from "./npc-over-body";

/**
 * A fall dead that fits, as its clip, the turn it takes, and how far it slides to a stagger spot, if it must.
 * Else one over the living alone, who make way. Else one onto whoever is there. Walls all round have them collapse
 */
export function fitDeath(
  anim: NpcAnimation,
  key: AnimationClipKey,
  dir?: THREE.Vector3,
): [AnimationClipKey, number, null | Geom.VectJson] {
  const { point, nodeRef } = anim.npc;
  /** The shot's way, turned at random, mostly a little: so the dead do not lie aligned */
  const off = dir?.clone().applyAxisAngle(upAxis, deathConfig.fallJitter * THREE.MathUtils.randFloatSpread(2) ** 3);
  const clear = fitFall(anim, key, off);
  if (clear !== null) return [...clear, null];
  const spot = staggerTo(anim, key, off);
  if (spot !== null) return [...spot.fit, { x: spot.at.x - point.x, y: spot.at.y - point.y }];
  const last = fitFall(anim, key, off, point, nodeRef, "dead") ?? fitFall(anim, key, off, point, nodeRef, "none");
  return last !== null ? [...last, null] : [hitConfig.sink, 0, null];
}

/**
 * Where they stagger to, killed by `clip` with no room to fall here: within `staggerBy` along the shot, give or take 45°,
 * with no one in the way. Also the fall there. `null` if they may fall here, or nowhere there will do
 */
export function staggerSpot(anim: NpcAnimation, clip: null | AnimationClipKey, dir?: THREE.Vector3) {
  if (clip === null || dieClips.has(clip) === false || fitFall(anim, clip, dir) !== null) return null;
  return staggerTo(anim, clip, dir);
}

/**
 * The living where their fall lies, the player among them, each with where they step aside to: out of its strip,
 * to the nearer side — see `w.e.takeHit`
 */
export function inTheWay(anim: NpcAnimation): { npc: Npc; to: Geom.VectJson }[] {
  const { fall: f, hurt } = anim;
  if (f == null || hurt === null) return [];
  const side = sideOf(hurt.key);
  const way = fallWay(side, f.ry + f.turn);
  const at = { x: f.start.x + f.shift.x, y: f.start.y + f.shift.y };
  const length = deathConfig.lieLength[side];
  /** Their middle stands this far off the fall's line, so the body passes beside them */
  const clear = deathConfig.lieWidth + npcDims.agentRadius;
  return anim.w.npc.near.inReach(anim.npc.key, 0).flatMap((other) => {
    if (other.anim.dead === true || other.anim.fall != null) return [];
    const [dx, dz] = [other.position.x - at.x, other.position.z - at.y];
    const along = dx * way.x + dz * way.y;
    const across = dx * way.y - dz * way.x;
    if (along < -npcDims.agentRadius || along > length || Math.abs(across) >= clear) return [];
    const by = (Math.sign(across) || 1) * clear;
    return [{ npc: other, to: { x: at.x + along * way.x + by * way.y, y: at.y + along * way.y - by * way.x } }];
  });
}

/** Falling dead, they leave the crowd: the clip carries them, and the npc goes with their hips — see `tickFall` */
export function startFall(anim: NpcAnimation, turn: number, slide: null | Geom.VectJson = null) {
  const { npc } = anim;
  const hips = npc.group?.getObjectByName("hips");
  if (hips === undefined) return;
  const ry = npc.rotation.y;
  const shift = roomToLie(anim, ry + turn); // whilst their agent still gives their poly
  if (slide !== null) shift.add(slide);
  Object.assign(anim.face, { rate: 0, turn: null, aim: null }); // they turn by `turn` alone
  anim.w.npc.removeAgents([npc], { keepPhysics: true });
  const start = new THREE.Vector2(npc.position.x, npc.position.z);
  const from = hipsOffset(anim, hips, new THREE.Vector2());
  anim.fall = { start, from, shift, hips, ry, turn, wrote: new THREE.Vector3(Number.NaN) };
}

/**
 * Falling dead, the npc moves as far as the clip has carried their hips, plus the slide eased in.
 * Their root goes back as far, so they look the same, and their shadow and corpse are where their body is
 */
export function tickFall(anim: NpcAnimation) {
  const f = anim.fall;
  const { hurt, npc } = anim;
  if (f == null || hurt === null || dieClips.has(hurt.key) === false) return;
  const root = f.hips.parent;
  if (root?.parent == null) return;
  if (root.position.equals(f.wrote)) return; // held at its end, the mixer leaves the root where this put it
  const travel = hipsOffset(anim, f.hips, tmpFallTravel).sub(f.from);
  // their hips, as `hipsOffset` left them
  if (f.landed !== true && tmpFallAt.y - npc.position.y < deathConfig.fellHipsY) {
    f.landed = true;
    anim.w.events.next({ key: "npc-fell", npcKey: npc.key });
  }
  const u = Math.min(1, hurt.secs / (npc.clips[hurt.key].duration * deathConfig.fitBy));
  const slide = u * u * (3 - 2 * u);
  npc.rotation.y = f.ry + slide * f.turn;
  const [x, z] = [f.start.x + travel.x + slide * f.shift.x, f.start.y + travel.y + slide * f.shift.y];
  f.wrote.copy(carry(anim, root, root.parent, travel, x, z));
}

/** On a new mesh, e.g. the glTF refetched, their fall moves onto its hips, and its root is written afresh */
export function rebindFall(anim: NpcAnimation) {
  const f = anim.fall;
  if (f == null) return; // nearly always
  const hips = anim.npc.group?.getObjectByName("hips");
  if (hips === undefined || hips === f.hips) return;
  f.hips = hips;
  f.wrote.set(Number.NaN, Number.NaN, Number.NaN);
  anim.rise?.wrote.set(Number.NaN, Number.NaN, Number.NaN);
}

/**
 * Dead as restored, e.g. from a save: held at the end of `clip`. A fall lies over where the npc stands,
 * out of the crowd, its corpse's sensor put back
 */
export function restoreDead(anim: NpcAnimation, clip: AnimationClipKey) {
  const { npc } = anim;
  const { duration } = npc.clips[clip];
  anim.dead = true;
  anim.hurt = { key: clip, secs: duration, next: null };
  anim.setPose(clip, { force: true, fade: 0 });
  npc.setLabelYShift(npc.labelShift ?? npc.labelYShiftUniform.value); // lain already, so no glide
  const hips = npc.group?.getObjectByName("hips");
  const action = anim.mixer.existingAction(npc.clips[clip]);
  if (dieClips.has(clip) && hips !== undefined && action !== null) {
    anim.w.npc.removeAgents([npc], { keepPhysics: true });
    action.time = 0;
    anim.mixer.update(0);
    const from = hipsOffset(anim, hips, new THREE.Vector2());
    action.time = duration;
    anim.mixer.update(0);
    const travel = hipsOffset(anim, hips, new THREE.Vector2()).sub(from);
    const start = new THREE.Vector2(npc.position.x - travel.x, npc.position.z - travel.y);
    const [shift, wrote] = [new THREE.Vector2(), new THREE.Vector3(Number.NaN)];
    anim.fall = { start, from, shift, hips, ry: npc.rotation.y, turn: 0, wrote, landed: true };
    tickFall(anim);
  }
  anim.holdStill();
  anim.w.r3f?.invalidate();
}

/**
 * Revived from a fall, they get up by its `deathConfig.getUp` clip, their root held back as it lay.
 * `false` if their fall has none, so they are let go at once
 */
export function startRise(anim: NpcAnimation) {
  const { fall: f, hurt } = anim;
  const key = hurt === null ? undefined : deathConfig.getUp[hurt.key];
  const root = f?.hips.parent;
  if (f == null || hurt === null || key === undefined || root == null) return false;
  const clip = anim.npc.clips[hurt.key];
  const end = rootAt(clip, true, new THREE.Vector3());
  if (end === null) return false;
  removeCorpseCollider(anim);
  anim.dead = false;
  anim.setEyes("open");
  const start = new THREE.Vector2(anim.npc.position.x, anim.npc.position.z);
  anim.rise = { offset: end.sub(root.position), wrote: new THREE.Vector3(Number.NaN), start, from: null };
  anim.hurt = { key, secs: 0, next: null };
  anim.setPose(key, { force: true, fade: hitConfig.fadeInSecs });
  anim.w.r3f?.invalidate();
  anim.w.events.next({ key: "npc-hurt", npcKey: anim.npc.key, clip: key, dead: false });
  return true;
}

/**
 * Getting up, their root is held back as it lay, and the npc follows their hips as `tickFall` does.
 * So their body never jumps, and their label and shadow stay over it — see `startRise`
 */
export function tickRise(anim: NpcAnimation) {
  const { fall: f, rise: r } = anim;
  const root = f?.hips.parent;
  if (r == null || f == null || root?.parent == null || root.position.equals(r.wrote)) return;
  root.position.sub(r.offset);
  const travel = hipsOffset(anim, f.hips, tmpFallTravel);
  r.from ??= travel.clone(); // as they lay
  travel.sub(r.from);
  r.wrote.copy(carry(anim, root, root.parent, travel, r.start.x + travel.x, r.start.y + travel.y));
}

/** Stood up, the hold on their root goes and the npc moves by as much, so their body stays, now in their idle */
export function finishRise(anim: NpcAnimation) {
  const r = anim.rise;
  const root = anim.fall?.hips.parent;
  anim.rise = null;
  if (r == null || root?.parent == null) return;
  const idle = rootAt(anim.idleClip, false, tmpRiseTo);
  if (idle === null) return;
  root.parent.updateWorldMatrix(true, false);
  const now = root.parent.localToWorld(tmpRiseFrom.copy(root.position));
  const then = root.parent.localToWorld(idle);
  anim.npc.position.x += now.x - then.x;
  anim.npc.position.z += now.z - then.z;
}

/** Whether a shot along world `dir` pushes one facing `ry` backwards, i.e. it came from in front. Their front is -z */
export function pushedBack(dir: undefined | THREE.Vector3, ry: number) {
  return dir === undefined || dir.x * Math.sin(ry) + dir.z * Math.cos(ry) > 0;
}

/** Each clip made by mirroring another, by the clip it mirrors — see `mirroredClips` */
export const mirrorOf = new Map(Object.entries(mirroredClips).map(([to, from]) => [from, to as AnimationClipKey]));

/** Clips they fall dead by, and their mirrors, which a death plays either at random */
export const dieClips = new Set(Object.values(deathConfig.die).flatMap((key) => [key, mirrorOf.get(key) ?? key]));

/** Clips they get up by, revived */
export const riseClips = new Set(Object.values(deathConfig.getUp).flatMap((key) => key ?? []));

/**
 * A fall dead from `at` on `nodeRef` that fits, as its clip and the turn it takes, else `null`.
 * The shot's way is tried first, turned less before more, then the other way. `others` says who must be clear of it
 */
function fitFall(
  anim: NpcAnimation,
  key: AnimationClipKey,
  dir?: THREE.Vector3,
  at = anim.npc.point,
  nodeRef = anim.npc.nodeRef,
  others: Others = "all",
) {
  const side: FallSide = key === deathConfig.die.back ? "back" : "forward";
  for (const way of side === "back" ? fallSides : [...fallSides].reverse()) {
    /** The shot's way is turned to fall along the shot: the other way keeps their facing */
    const along = way === side && dir !== undefined ? alongShot(way, dir, anim.npc.rotation.y) : 0;
    for (const turn of deathConfig.fitTurns)
      if (fallFits(anim, way, along + turn, at, nodeRef, others))
        return [deathConfig.die[way], along + turn] as [AnimationClipKey, number];
  }
  return null;
}

/** Where they stagger to and fall there, as `staggerSpot`, already known to have no room to fall here */
function staggerTo(anim: NpcAnimation, clip: AnimationClipKey, dir?: THREE.Vector3) {
  const { npc } = anim;
  const { nodeRef } = npc;
  if (nodeRef === null) return null;
  const toward = dir === undefined ? 0 : Math.atan2(dir.z, dir.x);
  for (const by of deathConfig.staggerBy)
    for (const k of [0, 1, -1]) {
      const way = { x: Math.cos(toward + (k * Math.PI) / 4), y: Math.sin(toward + (k * Math.PI) / 4) };
      if (npc.roomAhead(npc.point, nodeRef, by, way, way, npc.openDoorsFilter).room < by) continue;
      if (stripClear(anim, npc.point, way, by, deathConfig.lieWidth / 2) === false) continue; // never through anyone
      const at = { x: npc.point.x + by * way.x, y: npc.point.y + by * way.y };
      const near = anim.w.npc.getClosestPoly(at, 0.1);
      const fit = near.success === true ? fitFall(anim, clip, dir, at, near.nodeRef) : null;
      if (fit !== null) return { at, fit };
    }
  return null;
}

/** Whether falling from `at` to `side`, turned `turn`, has clear floor for their length, and none of `others` on it */
function fallFits(
  anim: NpcAnimation,
  side: FallSide,
  turn: number,
  at: Geom.VectJson,
  nodeRef: null | number,
  others: Others,
) {
  const { npc } = anim;
  if (nodeRef === null) return true;
  const ry = npc.rotation.y + turn;
  const way = fallWay(side, ry);
  const length = deathConfig.lieLength[side];
  if (npc.roomAhead(at, nodeRef, length, way, way, npc.openDoorsFilter).room < length) return false;
  return others === "none" || stripClear(anim, at, way, length, deathConfig.othersWidth, others === "all");
}

/** Whether no corpse in their room, nor anyone if `living`, is in the strip `length` along `way` from `at`, `half` either side */
function stripClear(
  anim: NpcAnimation,
  at: Geom.VectJson,
  way: Geom.VectJson,
  length: number,
  half: number,
  living = true,
) {
  return anim.w.npc.near.inReach(anim.npc.key, 0).every((other) => {
    const body = other.anim.fall?.body;
    if (body != null) return bodyCrosses(body, at, way, length, half) === false;
    if (living === false) return true;
    const [dx, dz] = [other.position.x - at.x, other.position.z - at.y];
    const along = dx * way.x + dz * way.y;
    return along < 0 || along > length || Math.abs(dx * way.y - dz * way.x) > half;
  });
}

/** Falling dead, they need `deathConfig.lieWidth` either side: a wall nearer has their agent pinned away from it */
function roomToLie(anim: NpcAnimation, ry: number): THREE.Vector2 {
  const { npc } = anim;
  const { nodeRef } = npc;
  if (nodeRef === null) return new THREE.Vector2();
  const half = deathConfig.lieWidth;
  const side = { x: Math.cos(ry), y: -Math.sin(ry) };
  const roomOn = (sign: number) => {
    const way = { x: sign * side.x, y: sign * side.y };
    return npc.roomAhead(npc.point, nodeRef, half, way, way, npc.openDoorsFilter).room;
  };
  /** Metres along `side`: away from whichever side is short, never past the other */
  const shift = Math.max(0, half - roomOn(-1)) - Math.max(0, half - roomOn(1));
  return Math.abs(shift) < 0.02 ? new THREE.Vector2() : new THREE.Vector2(shift * side.x, shift * side.y);
}

/** Moves the npc to `x, z`, and their root back by `travel` in its parent's frame, so their body stays where the clip put it */
function carry(
  anim: NpcAnimation,
  root: THREE.Object3D,
  parent: THREE.Object3D,
  travel: THREE.Vector2,
  x: number,
  z: number,
) {
  const { position } = anim.npc;
  const [x0, z0] = [position.x, position.z];
  [position.x, position.z] = [x, z];
  const back = parent.worldToLocal(tmpFallAt.set(x0 + travel.x, 0, z0 + travel.y));
  return root.position.sub(back.sub(parent.worldToLocal(tmpFallFrom.set(x0, 0, z0))));
}

/** Their hips across the floor from where the npc stands */
function hipsOffset(anim: NpcAnimation, hips: THREE.Object3D, out: THREE.Vector2) {
  hips.updateWorldMatrix(true, false);
  const at = hips.getWorldPosition(tmpFallAt);
  return out.set(at.x - anim.npc.position.x, at.z - anim.npc.position.z);
}

/** Where `clip` has their root at its start, or `end`, in its parent's frame, else `null` for none */
function rootAt(clip: THREE.AnimationClip, end: boolean, out: THREE.Vector3) {
  const values = clip.tracks.find((t) => t.name === "skeleton-root.position")?.values;
  return values === undefined ? null : out.fromArray(values, end ? values.length - 3 : 0);
}

/** Which way a die clip falls, mirrored or not */
function sideOf(key: AnimationClipKey): FallSide {
  return key === deathConfig.die.back || key === mirrorOf.get(deathConfig.die.back) ? "back" : "forward";
}

/** The floor's way one facing `ry` falls to `side`. Their ahead is (-sin, -cos) */
function fallWay(side: FallSide, ry: number) {
  const sign = side === "back" ? -1 : 1;
  return { x: -sign * Math.sin(ry), y: -sign * Math.cos(ry) };
}

/** Radians one facing `ry` turns so a fall to `side` goes along the shot's world `dir`. Their ahead is (-sin, -cos) */
function alongShot(side: FallSide, dir: THREE.Vector3, ry: number) {
  const sign = side === "forward" ? 1 : -1;
  const want = Math.atan2(-sign * dir.x, -sign * dir.z);
  return Math.atan2(Math.sin(want - ry), Math.cos(want - ry));
}

/** The ways one may fall dead */
type FallSide = "back" | "forward";
/** Who a fall dead must keep clear of: everyone, corpses alone (the living make way), or no one but walls */
type Others = "all" | "dead" | "none";
const fallSides: FallSide[] = ["back", "forward"];

const upAxis = new THREE.Vector3(0, 1, 0);
const tmpFallAt = new THREE.Vector3();
const tmpFallFrom = new THREE.Vector3();
const tmpFallTravel = new THREE.Vector2();
const tmpRiseFrom = new THREE.Vector3();
const tmpRiseTo = new THREE.Vector3();
