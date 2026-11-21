import * as THREE from "three/webgpu";
import { hitConfig, stepFlinchConfig } from "../const.npc";
import { bodyPart } from "../service/phaser-beam";
import { corpseColliderKey } from "../service/physics-bijection";
import type { NpcAnimation } from "./npc-animation";
import { flinch } from "./npc-flinch";

/**
 * Over a corpse, each foot lifts whilst over their body, whilst `on` holds its npcKey.
 * See "Walking over a corpse" in `docs/engagements.md`.
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

/**
 * Where a corpse lies, along their side then ahead from `x, z` as they face `ry`.
 * `hull` is their footprint, and `top` their torso's height.
 */
export type CorpseBody = { x: number; z: number; ry: number; hull: THREE.Vector2[]; top: number };

/** Puts a corpse's rect sensor round their body as it lies, and gives where it lies */
export function addCorpseCollider(anim: NpcAnimation): null | CorpseBody {
  const { npc } = anim;
  const [x, z, ry] = [npc.position.x, npc.position.z, npc.rotation.y];
  const points: THREE.Vector2[] = [];
  let top = 0;
  npc.group?.updateWorldMatrix(true, true);
  for (const name of corpseParts) {
    const found = bodyPart(npc, name);
    if (found === null) continue;
    const { min, max } = found.box;
    for (let i = 0; i < 8; i++) {
      const p = tmpCorner.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z);
      p.applyMatrix4(found.bone.matrixWorld);
      points.push(toBody(p.x - x, p.z - z, ry, new THREE.Vector2()));
      if (name !== "head") top = Math.max(top, p.y); // a big head would have them stand high on it
    }
  }
  if (points.length === 0) return null;
  const body = { x, z, ry, hull: convexHull(points), top };
  postCorpseCollider(anim.w, npc.key, body);
  return body;
}

/** Posts the sensor round where `npcKey`'s corpse lies, e.g. again once the physics world is rebuilt */
export function postCorpseCollider(w: NpcAnimation["w"], npcKey: string, { x, z, ry, hull }: CorpseBody) {
  const [side, ahead] = [
    { x: Math.cos(ry), y: -Math.sin(ry) },
    { x: -Math.sin(ry), y: -Math.cos(ry) },
  ];
  const rect = new THREE.Box2().setFromPoints(hull).expandByScalar(hitConfig.overBody.margin);
  // a rect runs `width` along its angle from its corner, and `height` at right angles: here `side` and back
  w.physics.worker.postMessage({
    type: "add-physics-colliders",
    colliders: [
      {
        type: "rect",
        colliderKey: corpseColliderKey(npcKey),
        x: x + rect.min.x * side.x + rect.max.y * ahead.x,
        y: z + rect.min.x * side.y + rect.max.y * ahead.y,
        width: rect.max.x - rect.min.x,
        height: rect.max.y - rect.min.y,
        angle: -ry,
        userData: { corpse: npcKey },
      },
    ],
  } satisfies WW.MsgToWorker);
}

/** Whether a corpse's body crosses the strip `length` along `way` from `from`, `half` either side of it */
export function bodyCrosses(body: CorpseBody, from: Geom.VectJson, way: Geom.VectJson, length: number, half: number) {
  const [c, s] = [Math.cos(body.ry), Math.sin(body.ry)];
  /** The hull along `way` then across it, from `from` */
  const hull = body.hull.map((v) => {
    const [dx, dz] = [body.x + v.x * c - v.y * s - from.x, body.z - v.x * s - v.y * c - from.y];
    return { a: dx * way.x + dz * way.y, b: dx * way.y - dz * way.x };
  });
  const strip = [
    { a: 0, b: -half },
    { a: 0, b: half },
    { a: length, b: half },
    { a: length, b: -half },
  ];
  // apart if either's edges separate them
  for (const [poly, other] of [
    [strip, hull],
    [hull, strip],
  ])
    for (let i = 0; i < poly.length; i++) {
      const [p, q] = [poly[i], poly[(i + 1) % poly.length]];
      const n = { a: q.b - p.b, b: p.a - q.a };
      const [lo, hi] = spanOf(poly, n);
      const [otherLo, otherHi] = spanOf(other, n);
      if (otherHi < lo || hi < otherLo) return false;
    }
  return true;
}

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
  if (on === false && (o.rise ?? 0) === 0) return; // undefined from before hmr
  const { group } = anim.npc;
  if (group === null || findBones(o, anim, group) === false) return;
  group.updateWorldMatrix(true, true);
  const lifts = on ? [o.legs[2].bone, o.legs[5].bone].map((foot, i) => footLift(o, anim, foot, i)) : [0, 0];
  const step = delta * hitConfig.overBody.speed;
  const goal =
    anim.hurry === true && anim.moving === true ? Math.max(lifts[0], lifts[1]) : Math.min(lifts[0], lifts[1]);
  const rise = (o.rise = THREE.MathUtils.clamp(goal, (o.rise ?? 0) - step, (o.rise ?? 0) + step));
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
  if (o.of === group && o.soles !== undefined) return o.thigh > 0; // undefined from before hmr
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
    if (other === undefined || body?.hull === undefined) continue; // undefined from before hmr
    const up = upRamp(body.hull, toBody(p.x - body.x, p.z - body.z, body.ry, tmpPoint));
    if (up > 0) under = other;
    most = Math.max(most, up * (body.top + hitConfig.overBody.clear) - p.y);
  }
  const planted = under !== null && p.y < plantedBelow;
  if (under !== null && planted && o.planted?.[i] !== true) jolt(under, p, anim.npc.key);
  (o.planted ??= [false, false])[i] = planted; // undefined from before hmr
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

/** How far up a body's ramp `at` is: `0` off it, `1` from `ramp` inside its edge */
function upRamp(hull: THREE.Vector2[], at: THREE.Vector2) {
  let depth = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const [a, b] = [hull[i], hull[(i + 1) % hull.length]];
    const [ex, ey] = [b.x - a.x, b.y - a.y];
    // anticlockwise, so its inside is on each edge's left
    depth = Math.min(depth, (ex * (at.y - a.y) - ey * (at.x - a.x)) / Math.hypot(ex, ey));
  }
  const u = THREE.MathUtils.clamp(depth / hitConfig.overBody.ramp, 0, 1);
  return u * u * (3 - 2 * u);
}

/** The anticlockwise convex hull of `points` (Andrew's monotone chain) */
function convexHull(points: THREE.Vector2[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: THREE.Vector2[]) => {
    const out: THREE.Vector2[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop(); // the other half starts with it
    return out;
  };
  return [...half(sorted), ...half(sorted.reverse())];
}

/** The least and most of `points` along `n` */
function spanOf(points: { a: number; b: number }[], n: { a: number; b: number }) {
  const dots = points.map((p) => p.a * n.a + p.b * n.b);
  return [Math.min(...dots), Math.max(...dots)];
}

/** A world offset `dx, dz` along one facing `ry`'s side then ahead */
function toBody(dx: number, dz: number, ry: number, out: THREE.Vector2) {
  const [c, s] = [Math.cos(ry), Math.sin(ry)];
  return out.set(dx * c - dz * s, -dx * s - dz * c);
}

type Written<T> = { bone: THREE.Object3D; base: T; wrote: T };

/** The parts a corpse's body is fitted round */
const corpseParts = [
  ...["head", "chest", "stomach", "hips"],
  ...["leftarm", "rightarm", "leftforearm", "rightforearm"],
  ...["leftthigh", "rightthigh", "leftshin", "rightshin"],
];
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
