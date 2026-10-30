import * as THREE from "three/webgpu";
import type { Npc } from "../components/npc";
import { eased, type Fade, stepFade } from "./fade";

/** Whom a weapon locks on to, or where a shot at no one ends */
export type BeamTarget = NpcTarget | FreeShot;

/** Whom a weapon locks on to, and which of their bones' parts — `null`, or none such, is over their head */
export type NpcTarget = {
  npcKey: string;
  part: null | string;
  /** Where on the part it lands, in its bone's frame so it moves with them: else the part's middle */
  local?: null | THREE.Vector3;
};

/** A shot at no one, along the aim: `at` and `what` once its cast is back */
export type FreeShot = {
  npcKey: null;
  part: null;
  at: null | THREE.Vector3;
  /** Metres along the ground to `at`. The beam keeps it along the live aim */
  dist: null | number;
  what: null | StruckKind;
  /** What it struck, if decor */
  decorKey: null | string;
  casting: boolean;
};

/** What a shot at no one ended on. `nothing` is `alongMax` metres out */
export type StruckKind = "wall" | "door" | "obstacle" | "decor" | "shield" | "floor" | "ceiling" | "nothing";

export const isFreeShot = (target: null | BeamTarget): target is FreeShot => target !== null && target.npcKey === null;

/**
 * A weapon's beam, `shown` and `locked` on to `to` together, and the `gun` it leaves. A new target
 * waits for the old to fade out — bar whilst locked on, when the end glides straight there.
 */
export type Beam = {
  gun: Fade;
  shown: Fade;
  locked: Fade;
  /** Whom it is locked on to, or fading off */
  to: null | BeamTarget;
  /** Whom it is to be: pointing, and in sight */
  next: null | BeamTarget;
  /** Gliding to a new `to`: from where the end was, and how far along */
  glide: null | { from: THREE.Vector3; t: number };
  /** Where it ended, last tick, and where it is drawn to: the body part, gliding */
  end: THREE.Vector3;
  at: THREE.Vector3;
  /** Whether a shield stops it short of them */
  blocked: boolean;
  /** How far out it has reached: `1` as it locks on, kept as it lets go so it fades where it is, `0` once gone */
  reach: number;
};

export function createBeam(): Beam {
  const off = (): Fade => ({ presence: 0, target: 0 });
  return {
    gun: off(),
    shown: off(),
    locked: off(),
    to: null,
    next: null,
    glide: null,
    end: new THREE.Vector3(),
    at: new THREE.Vector3(),
    blocked: false,
    reach: 0,
  };
}

/**
 * Every fade a `step` further, forgetting a `next` no longer among `npcs` — `instant` lands the beam, as whilst
 * paused, but holds the gun: it comes and goes with the arm, which is then still
 */
export function advanceBeam(x: Beam, step: number, npcs: Record<string, unknown>, instant: boolean) {
  if (x.next !== null && x.next.npcKey !== null && !(x.next.npcKey in npcs)) x.next = null;
  if (sameTarget(x.to, x.next) === false) {
    const gliding = instant === false && x.to !== null && x.next !== null && x.locked.presence > 0;
    /** One shot at no one after another: both follow the live aim, so neither glides */
    const bothFree = isFreeShot(x.to) && isFreeShot(x.next);
    if (gliding) x.glide = bothFree ? null : { from: x.end.clone(), t: 0 };
    if (gliding || instant || x.locked.presence === 0) x.to = x.next;
  }
  x.locked.target = x.to !== null && x.next !== null ? 1 : 0;

  stepFade(x.gun, instant ? 0 : step);
  if (instant) step = 1;
  // shown and reaching out in a frame or two. Let go, it fades at the usual pace
  stepFade(x.shown, x.shown.target === 1 ? step * beamConfig.lockRate : step);
  stepFade(x.locked, x.locked.target === 1 ? step * beamConfig.lockRate : step);
  if (x.glide !== null && (x.glide.t = Math.min(1, x.glide.t + step)) === 1) x.glide = null;
}

/**
 * Where the beam from `tip` ends: its stub, on down the arm `along`, drawn to `part` of their target as it locks
 * on — to `stopped` instead, where a shield stops it. Letting go it stays there, and only fades
 */
export function beamEnd(
  x: Beam,
  tip: THREE.Vector3,
  along: THREE.Vector3,
  part: null | THREE.Vector3,
  stopped: null | THREE.Vector3,
) {
  // a shield in the way, or no longer: the end glides between where it stops and their part
  if ((stopped !== null) !== x.blocked && x.locked.presence > 0) x.glide = { from: x.end.clone(), t: 0 };
  x.blocked = stopped !== null;
  const end = x.end.copy(tip).addScaledVector(along, beamConfig.stub);
  if (part !== null) {
    const at = x.at.copy(stopped ?? part);
    if (x.glide !== null) at.lerpVectors(x.glide.from, tmpGlide.copy(at), eased(x.glide.t)); // tracks the target meanwhile
    // all the way at once as it locks on, even fired again as it fades: gone only once it has faded
    if (x.locked.target === 1) x.reach = 1;
    else if (x.locked.presence === 0) x.reach = 0;
    end.lerp(at, x.reach);
  }
  return end;
}

const sameTarget = (a: null | BeamTarget, b: null | BeamTarget) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.npcKey !== null &&
    b.npcKey !== null &&
    a.npcKey === b.npcKey &&
    a.part === b.part &&
    a.local === b.local);

/** Where a shot at `to` lands on `npc`: its `local` point on the part, else the part's middle */
export function targetPoint(npc: Npc, to: null | BeamTarget, out: THREE.Vector3) {
  const part = to?.part ?? null;
  const local = to === null || to.npcKey === null ? null : (to.local ?? null);
  const found = local === null ? null : bodyPart(npc, part);
  if (local === null || found === null) return bodyPartPoint(npc, part, out);
  found.bone.updateWorldMatrix(true, false); // else a frame stale: the frameloop is on demand
  return out.copy(local).applyMatrix4(found.bone.matrixWorld);
}

/** `part`'s bone on `npc`, and the box round what it moves most, in its own frame. `null` for none such */
export function bodyPart(npc: Npc, part: null | string) {
  const bone = part === null || part === "label" ? undefined : npc.skinnedMesh.skeleton.getBoneByName(part);
  const box = bone === undefined ? undefined : partBoxes(npc.skinnedMesh).get(bone.name);
  return bone === undefined || box === undefined ? null : { bone, box };
}

/** The middle of `part` on `npc`, in world space — over their head, where their label is, for none */
export function bodyPartPoint(npc: Npc, part: null | string, out: THREE.Vector3) {
  const found = bodyPart(npc, part);
  if (found === null) {
    return out.set(npc.position.x, npc.position.y + npc.anim.headY + beamConfig.headAbove, npc.position.z);
  }
  found.bone.updateWorldMatrix(true, false); // else a frame stale: the frameloop is on demand
  const end = limbEnds[found.bone.name];
  const child = end === undefined ? undefined : npc.skinnedMesh.skeleton.getBoneByName(end);
  if (child !== undefined) {
    child.updateWorldMatrix(false, false);
    return out.setFromMatrixPosition(found.bone.matrixWorld).lerp(tmpEnd.setFromMatrixPosition(child.matrixWorld), 0.5);
  }
  return found.box.getCenter(out).applyMatrix4(found.bone.matrixWorld);
}

/** A shin's box reaches the sole, so its middle is halfway from knee to ankle instead */
const limbEnds: Partial<Record<string, string>> = { leftshin: "leftfoot", rightshin: "rightfoot" };
const tmpEnd = new THREE.Vector3();

/** Each bone's part: the box round what it moves most, in its own frame, off the bind pose — one rig for all */
function partBoxes(mesh: THREE.SkinnedMesh) {
  let found = partBoxesByGeo.get(mesh.geometry);
  if (found !== undefined) return found;
  const { skeleton, geometry: geo } = mesh;
  const [position, joints, weights] = ["position", "skinIndex", "skinWeight"].map((key) => geo.getAttribute(key));
  const boxes = skeleton.bones.map(() => new THREE.Box3());
  const v = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    let best = 0;
    for (let k = 1; k < 4; k++) if (weights.getComponent(i, k) > weights.getComponent(i, best)) best = k;
    const j = joints.getComponent(i, best);
    boxes[j].expandByPoint(
      v.fromBufferAttribute(position, i).applyMatrix4(mesh.bindMatrix).applyMatrix4(skeleton.boneInverses[j]),
    );
  }
  found = new Map(skeleton.bones.flatMap((bone, j) => (boxes[j].isEmpty() ? [] : [[bone.name, boxes[j]]])));
  partBoxesByGeo.set(geo, found);
  return found;
}

const partBoxesByGeo = new WeakMap<THREE.BufferGeometry, Map<string, THREE.Box3>>();
const tmpGlide = new THREE.Vector3();

/** Where a ray meets a part: reused by each call, so copy what is kept */
export type PartHit = { part: string; local: THREE.Vector3; point: THREE.Vector3; dist: number };

/**
 * The nearest of `bones` on `npc` whose part `ray` meets, by the box round what its bone moves most: its name, where
 * in its frame, and where. Only bones near the ray's height across them are tested. `null` for none
 */
export function partOnRay(npc: Npc, ray: THREE.Ray, bones: Iterable<string>): null | PartHit {
  const { origin: o, direction: d } = ray;
  // where it crosses a cylinder about their middle, in plan: missing it, it misses them
  const [fx, fz] = [o.x - npc.position.x, o.z - npc.position.z];
  const [a, b] = [d.x * d.x + d.z * d.z, fx * d.x + fz * d.z];
  const r = beamConfig.cullRadius;
  const disc = b * b - a * (fx * fx + fz * fz - r * r);
  if (a < 1e-9 || disc < 0) return null;
  const [t0, t1] = [Math.max(0, (-b - Math.sqrt(disc)) / a), (-b + Math.sqrt(disc)) / a];
  if (t1 < 0) return null;
  /** Its heights across them */
  const [y0, y1] = [o.y + d.y * t0, o.y + d.y * t1];
  const [yMin, yMax] = [Math.min(y0, y1), Math.max(y0, y1)];
  const { root, parts } = partsOf(npc.skinnedMesh);
  root.updateWorldMatrix(true, true); // every bone as posed now, once
  tmpPartHit.dist = Infinity;
  for (const name of bones) {
    const found = parts.get(name);
    if (found === undefined) continue;
    const { bone, box, reach } = found;
    const boneY = bone.matrixWorld.elements[13];
    if (boneY + reach < yMin || boneY - reach > yMax) continue;
    const local = tmpBoneRay.copy(ray).applyMatrix4(tmpInverse.copy(bone.matrixWorld).invert());
    if (local.intersectBox(box, tmpHit) === null) continue;
    const dist = tmpWorld.copy(tmpHit).applyMatrix4(bone.matrixWorld).distanceTo(o);
    if (dist >= tmpPartHit.dist) continue;
    Object.assign(tmpPartHit, { part: name, dist });
    tmpPartHit.local.copy(tmpHit);
    tmpPartHit.point.copy(tmpWorld);
  }
  return tmpPartHit.dist === Infinity ? null : tmpPartHit;
}

/** Each bone of `mesh` with a part, by name: its box, and how far from the bone its farthest corner is. And their root */
function partsOf(mesh: THREE.SkinnedMesh) {
  let found = partsBySkeleton.get(mesh.skeleton);
  if (found !== undefined) return found;
  const boxes = partBoxes(mesh);
  const { bones } = mesh.skeleton;
  const parts = new Map(
    bones.flatMap((bone) => {
      const box = boxes.get(bone.name);
      if (box === undefined) return [];
      const { min, max } = box;
      const reach = Math.hypot(...(["x", "y", "z"] as const).map((k) => Math.max(Math.abs(min[k]), Math.abs(max[k]))));
      return [[bone.name, { bone, box, reach }] as const];
    }),
  );
  found = { root: bones.find((bone) => bone.parent?.type !== "Bone") ?? bones[0], parts };
  partsBySkeleton.set(mesh.skeleton, found);
  return found;
}

const partsBySkeleton = new WeakMap<
  THREE.Skeleton,
  { root: THREE.Bone; parts: Map<string, { bone: THREE.Bone; box: THREE.Box3; reach: number }> }
>();
const tmpPartHit: PartHit = { part: "", local: new THREE.Vector3(), point: new THREE.Vector3(), dist: Infinity };
const tmpBoneRay = new THREE.Ray();
const tmpHit = new THREE.Vector3();
const tmpWorld = new THREE.Vector3();
const tmpInverse = new THREE.Matrix4();

const beamConfig = {
  /** How many times faster a beam shows and reaches out than it fades: too fast to see it extend */
  lockRate: 10,
  /** Metres the beam is drawn back to as it lets go, on past the muzzle */
  stub: 0.05,
  /** Metres above the target's head bone the beam lands, for no body part */
  headAbove: 0.3,
  /** Metres round an npc's middle their parts may reach, an arm past their body: a ray missing it misses them */
  cullRadius: 0.45,
} as const;
