import * as THREE from "three/webgpu";
import { clutchConfig } from "../const.npc";
import { bodyPart } from "../service/phaser-beam";
import type { HitImpact, NpcAnimation, Side } from "./npc-animation";

/**
 * Whilst hurt, a hand on their `wound`, eased by `weight`. `base` is the pose's arm, `wrote` ours.
 * See "Where it lands" in `docs/engagements.md`.
 */
export const newClutch = () => ({
  side: "left" as Side,
  wound: null as null | Wound,
  /** The head or torso's face the hand holds: chosen once a wound, else it could flip as they move */
  face: null as null | "front" | "side",
  /** Seconds it is held for yet, once they recover */
  linger: 0,
  weight: 0,
  written: false,
  base: [new THREE.Quaternion(), new THREE.Quaternion()],
  wrote: [new THREE.Quaternion(), new THREE.Quaternion()],
});

export type Clutch = ReturnType<typeof newClutch>;

/** The wound a hand goes to: none for a kill. The left hand, unless it is on the left arm */
export function takeClutch(clutch: Clutch, anim: NpcAnimation, impact?: HitImpact) {
  clutch.wound = impact === undefined || impact.outcome === "kill" ? null : woundOf(anim, impact);
  clutch.face = null;
  clutch.side = leftArmBones.has(clutch.wound?.bone.name ?? "") ? "right" : "left";
}

/** Whilst hurt, a hand reaches for the wound, pushed out to its surface: only while within reach */
export function tickClutch(c: Clutch, anim: NpcAnimation, delta: number) {
  const { wound } = c;
  if (wound === null) return void (c.weight = 0); // nearly always
  // held whilst hurt, and `lingerSecs` after they recover, unless they move off or the arm is wanted
  c.linger = anim.hurt !== null ? clutchConfig.lingerSecs : (c.linger ?? 0) - delta;
  const { bones, key } = anim.upperOf(c.side);
  const on = anim.dead !== true && anim.moving === false && (anim.hurt !== null || key === null) && c.linger > 0;
  if (on === false && c.weight === 0) return;
  const [upper, fore] = bones;
  if (upper === undefined || fore === undefined) return void (c.weight = 0);
  const { palm, palmHead, cross, sideMin } = clutchConfig;
  const { npc } = anim;
  const { bone, local } = wound;
  bone.updateWorldMatrix(true, false);
  upper.bone.updateWorldMatrix(true, true);
  const shoulder = tmpShoulder.setFromMatrixPosition(upper.bone.matrixWorld);
  const ry = npc.rotation.y;
  const front = tmpFront.set(-Math.sin(ry), 0, -Math.cos(ry)); // their body faces -z
  const at = tmpAt;
  const core = coreParts.has(bone.name) ? bodyPart(npc, bone.name) : null;
  if (core !== null) {
    // the head or torso: held on its front or the side towards the hand, whichever is nearer, never its back
    const { min, max } = core.box;
    const p = tmpLocal.copy(local);
    const near = bone.worldToLocal(tmpAway.copy(shoulder));
    const own = Math.sign(near.x) || 1;
    const side = own > 0 ? max.x : min.x;
    const y = THREE.MathUtils.clamp(p.y, min.y + palm, max.y - palm);
    /** How far off it the hand rests: the head is met end-on, the torso along the forearm */
    const off = bone.name === "head" ? palmHead : palm;
    /** On its side towards the hand, in its front half */
    const onSide = tmpOut.set(side + own * off, y, THREE.MathUtils.clamp(p.z, min.z + palm, (min.z + max.z) / 2));
    // the side is taken when nearer the wound, unless the hand would fold up under the shoulder
    c.face ??= Math.abs(p.x - side) < Math.abs(p.z - min.z) && onSide.distanceTo(near) >= sideMin ? "side" : "front";
    if (c.face === "side") p.copy(onSide);
    else p.set(THREE.MathUtils.clamp(p.x, min.x + palm, max.x - palm), y, min.z - off);
    at.copy(bone.localToWorld(p));
  } else {
    const axis = bone.localToWorld(tmpAxis.set(0, local.y, 0));
    at.copy(bone.localToWorld(tmpLocal.copy(local)));
    const radius = at.distanceTo(axis);
    /** The surface's way out: never behind them, nor turned from the hand, so the arm stays clear of the body */
    const out = tmpOut.subVectors(at, axis).normalize();
    const away = tmpAway.subVectors(axis, shoulder).setY(0).normalize();
    out.addScaledVector(away, -Math.max(0, out.dot(away)));
    out.addScaledVector(front, lean - Math.min(0, out.dot(front))).normalize();
    at.copy(axis).addScaledVector(out, radius + palm);
    // a limb: never too far past their middle, nor inside the torso
    const chest = upper.bone.parent;
    if (chest !== null) {
      const p = chest.worldToLocal(tmpLocal.copy(at));
      /** The shoulder's side of their middle */
      const own = Math.sign(upper.bone.position.x);
      if (p.x * own < -cross) at.copy(chest.localToWorld(p.setX(-cross * own)));
    }
    // a point across the torso, up to just over its top, goes onto its front: the forearm never crosses the body
    for (const part of torsoParts) {
      const found = bodyPart(npc, part);
      if (found === null) continue;
      const { min, max } = found.box;
      const p = found.bone.worldToLocal(tmpLocal.copy(at));
      if (p.x < min.x || p.x > max.x || p.y < min.y || p.y > max.y + shoulderTop || p.z < min.z - palm) continue;
      at.copy(found.bone.localToWorld(p.set(p.x, Math.min(p.y, max.y), min.z - palm)));
      break;
    }
  }
  const armLength = 2 * shoulder.distanceTo(tmpElbow.setFromMatrixPosition(fore.bone.matrixWorld));
  const want = on && shoulder.distanceTo(at) <= reach * armLength;
  c.weight = THREE.MathUtils.clamp(c.weight + (want ? delta : -delta) / clutchConfig.easeSecs, 0, 1);
  if (c.weight === 0) return;
  const bend = elbowWay(anim, shoulder, at);
  c.base[0].copy(upper.bone.quaternion);
  c.base[1].copy(fore.bone.quaternion);
  anim.reachTo(c.side, at, c.weight * c.weight * (3 - 2 * c.weight), bend);
  c.wrote[0].copy(upper.bone.quaternion);
  c.wrote[1].copy(fore.bone.quaternion);
  c.written = true;
}

/**
 * Which way the elbow goes from `shoulder`: in front of the chest as far as the hand crosses their middle.
 * A hand on its own side has it out beside them instead
 */
function elbowWay(anim: NpcAnimation, shoulder: THREE.Vector3, hand: THREE.Vector3) {
  const { elbow } = clutchConfig;
  const found = bodyPart(anim.npc, "chest");
  const bend = tmpBend;
  if (found === null) return bend.set(0, -1, 0);
  const { bone, box } = found;
  const from = bone.worldToLocal(tmpFrom.copy(shoulder));
  const to = bone.worldToLocal(tmpTo.copy(hand));
  const own = Math.sign(from.x) || 1;
  /** `0` with the hand on its own side, `1` at their middle or past it */
  const crosses = THREE.MathUtils.clamp((own * (from.x - to.x)) / Math.abs(from.x || 1), 0, 1);
  /** `0` with the hand at the shoulder or lower, `1` well above it, e.g. at the head */
  const raised = THREE.MathUtils.clamp((to.y - from.y) / raisedBy, 0, 1);
  bend.lerpVectors(from, to, 0.5).setY((from.y + to.y) / 2 - elbow);
  bend.x = own * Math.max(own * bend.x, (box.max.x + elbow) * (1 - crosses));
  bend.z = THREE.MathUtils.lerp(to.z, box.min.z - elbow, Math.max(crosses, raised)); // their front is -z
  return bone.localToWorld(bend).sub(shoulder);
}

/** Where `impact` landed on its part, held in that bone's frame, and its way in their own frame */
function woundOf(anim: NpcAnimation, { part, at, dir }: HitImpact): null | Wound {
  const bone = anim.npc.group?.getObjectByName(part);
  if (bone === undefined) return null;
  bone.updateWorldMatrix(true, false);
  const toNpc = -anim.npc.rotation.y; // their group is not turned, so -z is ahead after this
  return { bone, local: bone.worldToLocal(at.clone()), dir: dir.clone().applyAxisAngle(yAxis, toNpc) };
}

/** Where a shot landed, in its bone's frame, and its way in their own frame */
type Wound = { bone: THREE.Object3D; local: THREE.Vector3; dir: THREE.Vector3 };

/** A wound on these is clutched by the right hand, any other by the left */
const leftArmBones = new Set(["leftarm", "leftforearm"]);
/** A clutch keeps out of these bones' boxes */
const torsoParts = ["chest", "stomach", "hips"];
/** A wound on these is held on its front, or its side towards the hand */
const coreParts = new Set(["head", ...torsoParts]);
/** Metres a hand is above the shoulder for its elbow to come fully forwards */
const raisedBy = 0.2;
/** Of the arm's length, how far a wound may be and still be reached */
const reach = 0.95;
/** Metres over the torso's top still taken onto its front, e.g. a shoulder */
const shoulderTop = 0.1;
/** How far a hand on a limb leans to their front */
const lean = 0.5;

const yAxis = new THREE.Vector3(0, 1, 0);
const tmpAt = new THREE.Vector3();
const tmpAxis = new THREE.Vector3();
const tmpAway = new THREE.Vector3();
const tmpBend = new THREE.Vector3();
const tmpElbow = new THREE.Vector3();
const tmpFrom = new THREE.Vector3();
const tmpFront = new THREE.Vector3();
const tmpLocal = new THREE.Vector3();
const tmpOut = new THREE.Vector3();
const tmpShoulder = new THREE.Vector3();
const tmpTo = new THREE.Vector3();
