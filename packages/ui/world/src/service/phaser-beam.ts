import * as THREE from "three/webgpu";
import type { Npc } from "../components/npc";
import { eased, type Fade, stepFade } from "./fade";

/** Whom a weapon locks on to, and which of their bones' parts — `null`, or none such, is over their head */
export type BeamTarget = { npcKey: string; part: null | string };

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
  };
}

/**
 * Every fade a `step` further, forgetting a `next` that `exists` denies — `instant` lands the beam, as whilst
 * paused, but holds the gun: it comes and goes with the arm, which is then still
 */
export function advanceBeam(x: Beam, step: number, exists: (npcKey: string) => boolean, instant: boolean) {
  if (x.next !== null && exists(x.next.npcKey) === false) x.next = null;
  if (sameTarget(x.to, x.next) === false) {
    const gliding = instant === false && x.to !== null && x.next !== null && x.locked.presence > 0;
    if (gliding) x.glide = { from: x.end.clone(), t: 0 };
    if (gliding || instant || x.locked.presence === 0) x.to = x.next;
  }
  x.locked.target = x.to !== null && x.next !== null ? 1 : 0;

  stepFade(x.gun, instant ? 0 : step);
  if (instant) step = 1;
  stepFade(x.shown, step);
  stepFade(x.locked, step);
  if (x.glide !== null && (x.glide.t = Math.min(1, x.glide.t + step)) === 1) x.glide = null;
}

/** Where the beam from `tip` ends: its stub, on down the arm `along`, drawn to `dst` as it locks on */
export function beamEnd(x: Beam, tip: THREE.Vector3, along: THREE.Vector3, dst: undefined | Npc) {
  const end = x.end.copy(tip).addScaledVector(along, beamConfig.stub);
  if (dst !== undefined) {
    const at = bodyPartPoint(dst, x.to?.part ?? null, x.at);
    if (x.glide !== null) at.lerpVectors(x.glide.from, tmpGlide.copy(at), eased(x.glide.t)); // tracks the target meanwhile
    end.lerp(at, eased(x.locked.presence));
  }
  return end;
}

const sameTarget = (a: null | BeamTarget, b: null | BeamTarget) =>
  a === b || (a !== null && b !== null && a.npcKey === b.npcKey && a.part === b.part);

/** The middle of `part` on `npc`, in world space — over their head, where their label is, for none */
function bodyPartPoint(npc: Npc, part: null | string, out: THREE.Vector3) {
  const bone = part === null || part === "label" ? undefined : npc.skinnedMesh.skeleton.getBoneByName(part);
  const centre = bone === undefined ? undefined : partCentres(npc.skinnedMesh).get(bone.name);
  if (bone === undefined || centre === undefined) {
    return out.set(npc.position.x, npc.position.y + npc.anim.headY + beamConfig.headAbove, npc.position.z);
  }
  bone.updateWorldMatrix(true, false); // else a frame stale: the frameloop is on demand
  return out.copy(centre).applyMatrix4(bone.matrixWorld);
}

/** Each bone's part: the middle of what it moves most, in its own frame, off the bind pose — one rig for all */
function partCentres(mesh: THREE.SkinnedMesh) {
  let centres = partCentresByGeo.get(mesh.geometry);
  if (centres !== undefined) return centres;
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
  centres = new Map(
    skeleton.bones.flatMap((bone, j) =>
      boxes[j].isEmpty() ? [] : [[bone.name, boxes[j].getCenter(new THREE.Vector3())]],
    ),
  );
  partCentresByGeo.set(geo, centres);
  return centres;
}

const partCentresByGeo = new WeakMap<THREE.BufferGeometry, Map<string, THREE.Vector3>>();
const tmpGlide = new THREE.Vector3();

const beamConfig = {
  /** Metres the beam is drawn back to as it lets go, on past the muzzle */
  stub: 0.05,
  /** Metres above the target's head bone the beam lands, for no body part */
  headAbove: 0.3,
} as const;
