/**
 * An npc's phaser arm: how it is held and aimed, its reach and lock, and its tuning (`phaserConfig`). Pure, bar
 * what it reads off the npc: `components/Phasers.tsx` drives it
 */
import { geomService } from "@npc-cli/util/geom-service";
import { deltaAngle } from "maath/misc";
import * as THREE from "three/webgpu";
import type { AnimationClipKey } from "../components/NPCs";
import type { Npc } from "../components/npc";
import type { UpperAim } from "../components/npc-animation";
import { hitConfig } from "../const.npc";
import { aimToRay } from "./aim-target";
import { eased } from "./fade";
import { type Beam, type BeamTarget, bodyPartPoint, type Leg, type NpcTarget, targetPoint } from "./phaser-beam";
import { gunMuzzle } from "./phaser-gun";
import type { PhaserLook, SpreadRay } from "./phaser-look";

export type Tilt = -1 | 0 | 1;

export type ArmEntry = {
  /** Their tilt, and its angle as it eases there, radians up */
  tilt: Tilt;
  pitch: number;
  /** Where the arm points whilst tilted with no beam, along the pitched aim */
  tiltAt: THREE.Vector3;
  /** Whose part they aim at, untargeted, since game `secs`: jsh `phaser kate at:rob part:head` */
  /** Not `held`, it is let go of once aimed */
  aimAt: null | { npcKey: string; part: string; held: boolean; secs: number };
  /** The pitch kept in place of the detent: the last an aim at a part asked for */
  pitchAt: null | number;
  /** The arm's aim we set, down the beam */
  armAim: null | UpperAim;
  /** Stood, the line the muzzle is held on, eased in whilst armed — see `holdLineOf` */
  hold?: { line: THREE.Ray; ramp: number; weight: number };
  /** Where the arm points sat or lain, ahead of any beam — see `armAimAt` */
  armAt: THREE.Vector3;
  armed: boolean;
  /** Aimed in earnest, Space held: see `isSteadied` */
  steady: boolean;
  /** Charging since game `since` — see `charge` */
  charge: null | { since: number };
  /** Cancelled at `from`, draining since game `since` */
  cool: null | { since: number; from: number };
  /** The charge its last shot was fired with, which widens its beam */
  fireCharge: number;
  /** A wall, closed door, or obstacle at the gun's height, within reach ahead: worked out each tick */
  armHit: boolean;
  beam: Beam;
  /** Where they stood, faced, and their target stood, when last cast — `null` is to cast again */
  cast: null | { x: number; z: number; ry: number; tx: number; tz: number; target: null | string };
  casting: boolean;
  /** World seconds of the last cast */
  castSecs: number;
  /** World seconds at which their beam reached out, whilst it does */
  firedSecs: null | number;
  /** The arm is still easing onto where it points — see `glideArmAt` */
  gliding: boolean;
  /** Their right forearm, and the model it was found in */
  hand: null | { of: Npc["group"]; bone: THREE.Object3D };
  /** Where the lock hit, whilst its beam fades: held there */
  hitAt: null | THREE.Vector3;
  /** World seconds they stay drawn in until */
  holdUntil: number;
  /** The stance they stood in before ours */
  idleBefore: null | AnimationClipKey;
  /** npcKey */
  key: string;
  /** Their phaser's look, rewritten each tick by `draw` */
  look: PhaserLook;
  /** A shotgun's rays as last cast, as `attachmentBeams.shotgun.angles`: each to a wall or shield, and its bounce. See `castSpread` */
  spread: null | (SpreadRay & { leg: null | Leg })[];
  /** An attachment's rays once struck: each ending on whom it meets, its bounce only after it met no one. See `spreadOn` */
  spreadHit: null | SpreadRay[];
  /** Whom their shot met, by npcKey: each one's outcome, and whether it has landed. Reset as it fires */
  met: Map<string, { outcome: JshCli.ShotOutcome; landed: boolean }>;
  /** The aim at their target, kept: its bearing is rewritten each tick */
  lockAim: { at: number; rate: number; untilRest: boolean };
  /** World seconds a one-off shot is lowered by at the latest, whilst there is one */
  lowerAt: null | number;
  /** Metres their muzzle sits to one side of them, as last drawn — their facing allows for it */
  muzzleRight: number;
  /** Someone within reach of the arm, as last polled — see `armMeetsNpc` */
  npcHit: boolean;
  /** World seconds of that poll */
  npcPolledSecs: number;
  /** The aim we set, so we replace or clear only ours */
  ownAim: Npc["anim"]["face"]["aim"];
  /** The stance we stand them in */
  ownIdle: null | AnimationClipKey;
  /** We turned them sat, so we turn them back */
  ownTurn: boolean;
  /** Where they last pointed, on the ground: by `pointAt`, or lain, at whom they were on */
  pointAt: null | Geom.VectJson;
  /** The last cast along the arm */
  reach: ArmReach;
  /** A shield within reach ahead, that their phaser is not let through */
  shielded: boolean;
  /** The shot its lock is, decided as it locks on */
  shot: null | ArmShot;
  /** The last cast along the beam */
  sight: ArmSight;
  /** The lock already struck with, so one shot hits once */
  struck: null | BeamTarget;
  /** Whom they lock on to whilst armed and in sight, or a shot at no one */
  target: null | BeamTarget;
  /** Whom they point at without locking on, sat or lain — see `arm` */
  toward: null | string;
};

/** Within reach ahead of the arm, as last cast */
export type ArmReach = {
  /** The obstacles there, at any height */
  obstacles: JshCli.RaycastResult["obstacles"];
  /** A wall or closed door there */
  wallHit: boolean;
};

/** Between the muzzle at full aim and their target's part, as last cast */
export type ArmSight = {
  /** The obstacles it crosses on the ground */
  across: JshCli.RaycastResult["obstacles"];
  /** Where the cast began */
  from: Geom.VectJson;
  /** Nothing between them and their target */
  inSight: boolean;
  /** Decor keys of the shields between them */
  shields: string[];
};

export type ArmShot = {
  to: NpcTarget;
  outcome: JshCli.ShotOutcome;
  /** Its line meeting no part of them, where it passes. It runs on to `past`, the wall beyond on the ground, once that is found */
  through: null | THREE.Vector3;
  past: null | Geom.VectJson;
  /** Passing them, whom it meets beyond in turn, each with its outcome: ghosts, then whom it lands on. `null` until found */
  beyond: null | (NpcTarget & { part: string; outcome: JshCli.ShotOutcome })[];
};

/** A segment on the ground: `x0, z0, x1, z1` */
export type Seg = [number, number, number, number];

/** Their gun's muzzle in world space, written to `out`: `null` with no forearm to hold it */
export function tipOf(npc: Npc, arm: ArmEntry, out: THREE.Vector3) {
  const hand = handOf(npc, arm);
  hand?.updateWorldMatrix(true, false); // else a frame stale: the frameloop is on demand
  return hand?.localToWorld(out.copy(muzzle)) ?? null;
}

/** Where a shot passing them ends: on through them to the wall or floor beyond. `null` for any other shot */
export function shotPast(arm: ArmEntry, from: THREE.Vector3, out: THREE.Vector3) {
  const { shot } = arm;
  if (shot === null || shot.through === null || shot.to !== arm.beam.to) return null;
  const { through, past } = shot;
  const run = Math.max(Math.hypot(through.x - from.x, through.z - from.z), 1e-3);
  let s =
    past === null
      ? 1 + phaserConfig.passStub / run // not found yet
      : Math.max(1, Math.hypot(past.x - from.x, past.y - from.z) / run);
  if (through.y < from.y) s = Math.min(s, from.y / (from.y - through.y)); // the floor first
  return out.lerpVectors(from, through, s);
}

/** Their gun's height at full aim, stood or crouched */
export const gunY = (npc: Npc) => npc.anim.headY - phaserConfig.gunBelowHead;

/** The line between their shoulder joints on the ground, as last drawn: else `null` without both bones */
export function shouldersOf(npc: Npc): null | Seg {
  const l = npc.anim.upperOf("left").bones[0]?.bone.matrixWorld.elements;
  const r = npc.anim.upperOf("right").bones[0]?.bone.matrixWorld.elements;
  return l === undefined || r === undefined ? null : [l[12], l[14], r[12], r[14]];
}

/**
 * Their gun at full aim, on the ground. Stood, from the elbow to the muzzle.
 * Else `reach` from their right shoulder, which lain is far from their middle
 */
export function gunLine(npc: Npc, arm: ArmEntry): Seg {
  const ry = armBearingOf(npc, arm);
  const [fx, fz] = [-Math.sin(ry), -Math.cos(ry)];
  if (npc.anim.posture === "stand") {
    const { ahead, from, right } = phaserConfig.gun;
    const [x, z] = [npc.position.x - fz * right, npc.position.z + fx * right];
    return [x + fx * from, z + fz * from, x + fx * ahead, z + fz * ahead];
  }
  const { x, z } = npc.anim.upper.bones[0]?.bone.getWorldPosition(tmpShoulder) ?? npc.position;
  return [x, z, x + fx * phaserConfig.reach, z + fz * phaserConfig.reach];
}

/** Stood, their aim's line from the muzzle at full aim, raised or still coming down: as `aimOf`, armed or not */
export function holdLineOf(npc: Npc, arm: ArmEntry, out: THREE.Ray) {
  const [ax, az, x, z] = gunLine(npc, arm);
  const bearing = geomService.getThreeRotationY(z - az, x - ax);
  const y = gunY(npc);
  return aimToRay({ from: { x, y: z }, bearing, y, pitch: arm.pitch ?? 0 }, out);
}

/** Their muzzle at full aim, on the ground */
export function muzzleAt(npc: Npc, arm: ArmEntry): Geom.VectJson {
  const [, , x, y] = gunLine(npc, arm);
  return { x, y };
}

/** Where the beam from `tip` to `end` first meets an obstacle it crosses, short of the part's own depth: else `null` */
export function acrossStop(arm: ArmEntry, tip: THREE.Vector3, end: THREE.Vector3, out: THREE.Vector3) {
  const run = Math.hypot(end.x - tip.x, end.z - tip.z) || 1e-6;
  const last = 1 - phaserConfig.partDepth / Math.max(run, phaserConfig.partDepth);
  // measured from where the cast began: the tip moves, e.g. as the arm comes down
  const { across, from } = arm.sight;
  const on = ((tip.x - from.x) * (end.x - tip.x) + (tip.z - from.y) * (end.z - tip.z)) / run;
  let first = last;
  for (const { dist, leave, top, bottom } of across) {
    const [t0, t1] = [Math.max(0, (dist - on) / run), Math.min((leave - on) / run, first)];
    if (t0 >= t1) continue;
    const [h0, h1] = [tip.y + (end.y - tip.y) * t0, tip.y + (end.y - tip.y) * t1];
    if (Math.max(h0, h1) < bottom || Math.min(h0, h1) > top) continue;
    // in at its side, else down through its top or up through its underside
    first = h0 >= bottom && h0 <= top ? t0 : t0 + ((t1 - t0) * ((h0 > top ? top : bottom) - h0)) / (h1 - h0);
  }
  return first === last ? null : out.lerpVectors(tip, end, first);
}

/** Metres from `(px, pz)` to the segment `s` */
export function toSeg(px: number, pz: number, s: Seg) {
  const [dx, dz] = [s[2] - s[0], s[3] - s[1]];
  const t = THREE.MathUtils.clamp(((px - s[0]) * dx + (pz - s[1]) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(px - s[0] - t * dx, pz - s[1] - t * dz);
}

/** Metres between two segments: zero when they cross */
export function segsApart(a: Seg, b: Seg) {
  const side = (px: number, pz: number, s: Seg) => Math.sign((s[2] - s[0]) * (pz - s[1]) - (s[3] - s[1]) * (px - s[0]));
  if (side(a[0], a[1], b) !== side(a[2], a[3], b) && side(b[0], b[1], a) !== side(b[2], b[3], a)) return 0;
  return Math.min(toSeg(a[0], a[1], b), toSeg(a[2], a[3], b), toSeg(b[0], b[1], a), toSeg(b[2], b[3], a));
}

/** Whether their last cast was made as things stand: they, and their target, where they were then */
export function isCastCurrent(arm: ArmEntry, npc: Npc, target: undefined | Npc) {
  const { cast } = arm;
  if (cast === null || cast.target !== (target?.key ?? null)) return false;
  const near = (ax: number, az: number, bx: number, bz: number) =>
    Math.hypot(ax - bx, az - bz) <= phaserConfig.recastMoved;
  const [tx, tz] = target === undefined ? [0, 0] : [target.position.x, target.position.z];
  return (
    near(cast.x, cast.z, npc.position.x, npc.position.z) &&
    Math.abs(deltaAngle(cast.ry, armBearingOf(npc, arm))) <= phaserConfig.recastTurned &&
    near(cast.tx, cast.tz, tx, tz)
  );
}

/** The obstacles the rays passed, each once: both rays usually pass the same */
export function distinctObstacles(rays: { obstacles: JshCli.RaycastResult["obstacles"] }[]) {
  const byKey = new Map(
    rays.flatMap(({ obstacles }) => obstacles.map((o) => [`${o.gmId} ${o.obstacleId}`, o] as const)),
  );
  return [...byKey.values()];
}

/** Where both sides of their arm end at arm's length, on the ground, led by their velocity. Stood, the gun is to their right */
export function armEnds(npc: Npc, arm: ArmEntry): Geom.VectJson[] {
  const ry = armBearingOf(npc, arm);
  const [fx, fz] = [-Math.sin(ry), -Math.cos(ry)];
  const [vx, , vz] = npc.agent?.velocity ?? [0, 0, 0];
  const { armWidth, leadSecs, reach } = phaserConfig;
  const [x, z] = [npc.position.x + vx * leadSecs + fx * reach, npc.position.z + vz * leadSecs + fz * reach];
  if (npc.anim.posture !== "stand") return [{ x, y: z }];
  const right = phaserConfig.gun.right + armWidth;
  return [
    { x, y: z },
    { x: x - fz * right, y: z + fx * right },
  ];
}

/**
 * Sets `arm.armHit` from the last cast's wall and the obstacles within reach as they stand now, so a crouch draws in at once.
 * Returns whether a raise or lower would swing the gun through one, between the hand at rest and the gun raised
 */
export function meetObstacles(npc: Npc, arm: ArmEntry) {
  arm.armHit = arm.reach.wallHit;
  // sat or lain, obstacles are what they sit or lie at
  if (npc.anim.posture !== "stand") return false;
  /** Stood or crouched, the gun's height */
  const atGun = gunY(npc);
  let swingHit = false;
  for (const { top, bottom } of arm.reach.obstacles) {
    // a top under the gun's line may still meet the hand and gun, which hang below it
    const underside = atGun - phaserConfig.gunDrop;
    if (atGun > bottom - phaserConfig.gunClear && underside < top + phaserConfig.gunClear) arm.armHit = true;
    if (top > atGun - phaserConfig.restBelowGun && bottom < atGun) swingHit = true;
  }
  return swingHit;
}

/** The way they aim: turned sat, or ahead of how they lie */
export const facingOf = (npc: Npc) => npc.anim.aimBearing() ?? npc.rotation.y;

/** The way their arm points: lain, anywhere in their pose's arc, so at `armAt` whilst it aims by it */
export const armBearingOf = (npc: Npc, arm: ArmEntry) =>
  arm.armAim?.at === arm.armAt ? npc.anim.bearingOf({ x: arm.armAt.x, y: arm.armAt.z }) : facingOf(npc);

/**
 * Where one sat or lain points their arm: at `on`'s part or chest whilst in reach. Else ahead the way they aim, at the
 * height of their head. Lain, as near `arm.pointAt` as their pose aims
 */
export function armAimAt(npc: Npc, arm: ArmEntry, on: undefined | Npc, inReach: boolean, out: THREE.Vector3) {
  if (on !== undefined && inReach === true) return bodyPartPoint(on, arm.target?.part ?? "chest", out);
  const { anim } = npc;
  const ry = (anim.posture === "lie" && arm.pointAt !== null ? anim.lieAimBearing(arm.pointAt) : null) ?? facingOf(npc);
  const { x, y, z } = npc.position;
  const ahead = phaserConfig.aimAhead;
  return out.set(
    x - Math.sin(ry) * ahead,
    y + npc.anim.headY + ahead * Math.tan(arm.pitch ?? 0),
    z - Math.cos(ry) * ahead,
  );
}

/** Eases `arm.armAt` to `want` over `delta` seconds. Newly aimed by it, from where the gun points now */
export function glideArmAt(npc: Npc, arm: ArmEntry, want: THREE.Vector3, delta: number) {
  const hand = arm.armAim?.at === arm.armAt ? null : handOf(npc, arm);
  if (hand !== null) {
    hand.updateWorldMatrix(true, false);
    const tip = hand.localToWorld(tmpTip.copy(muzzle));
    const along = tmpAlong.set(0, -1, 0).transformDirection(hand.matrixWorld);
    arm.armAt.copy(tip).addScaledVector(along, tip.distanceTo(want));
  }
  arm.armAt.lerp(want, 1 - Math.exp(-delta / phaserConfig.armGlideSecs));
  const distSq = arm.armAt.distanceToSquared(want);
  arm.gliding = Math.sqrt(distSq) > Math.tan(phaserConfig.armAimedRad) * want.distanceTo(npc.position);
  if (distSq < 1e-6) arm.armAt.copy(want);
  else npc.w.r3f?.invalidate(); // still on its way: the frameloop is on demand
  return arm.armAt;
}

/** The facing that lines `at` up, not on `npc`, but on a line `right` metres to their side */
export function bearingPast(npc: Npc, at: Geom.VectJson, right: number) {
  const [dx, dz] = [at.x - npc.position.x, at.y - npc.position.z];
  const turn = Math.asin(THREE.MathUtils.clamp(right / Math.hypot(dx, dz), -0.5, 0.5));
  return npc.anim.bearingOf(at) + turn;
}

/** Whether their muzzle's line passes within `lockRad` of where it locks on: always, on no one */
export function onLine(npc: Npc, arm: ArmEntry, target: undefined | Npc) {
  if (target === undefined) return true; // a shot at no one is cast along their aim
  const [ax, az, x, z] = gunLine(npc, arm);
  // sat or lain, along the arm to where it points, as `aimOf`
  const [tx, tz] = arm.armAim?.at === arm.armAt ? [arm.armAt.x, arm.armAt.z] : [x, z];
  const at = lockPoint(target, arm);
  const off = deltaAngle(
    geomService.getThreeRotationY(tz - az, tx - ax),
    geomService.getThreeRotationY(at.y - z, at.x - x),
  );
  return Math.abs(off) < phaserConfig.lockRad;
}

/** The part locked on to, on the ground: their middle for none */
export function lockPoint(target: Npc, arm: ArmEntry) {
  const { x, z } = targetPoint(target, arm.target, tmpLock);
  return Object.assign(tmpLockAt, { x, y: z });
}

export const phaserConfig = {
  /** The pose they stand in and aim with, and the one drawn in to whenever the arm would touch someone or something */
  pose: "phaser_aim",
  avoid: "phaser_aim_avoid",
  /** Metres ahead a wall or closed door blocks — just past the gun at arm's length, so it is drawn in in time */
  reach: 0.75,
  /** Seconds of their velocity a wall is looked for ahead of, so the arm is drawn in before it gets there */
  leadSecs: 0.3,
  /** Metres the gun is below their head's pivot at full aim, stood or crouched */
  gunBelowHead: 0.07,
  /** Metres the gun must clear an obstacle by, above or below */
  gunClear: 0.05,
  /** Metres the hand and the gun's body hang below the gun's line, as an obstacle's top must clear */
  gunDrop: 0.12,
  /** Metres the hand hangs at rest below the gun raised, which a raise or lower swings between */
  restBelowGun: 0.5,
  /** Metres from the arm's line to its side, gun included, that someone within reach must keep clear of */
  armWidth: 0.1,
  /** Metres round the line between a standing body's shoulder joints, which the arm must miss */
  bodyRadius: 0.15,
  /** Metres of a body part before its middle, in which nothing hides it: e.g. a thigh on its seat */
  partDepth: 0.12,
  /** Metres of a stood npc's gun at full aim, in their aim's frame: ahead to the elbow and muzzle, and to their right */
  gun: { from: 0.32, ahead: 0.75, right: 0.19 },
  /** Metres ahead one sat or lain points with nobody to aim at */
  aimAhead: 5,
  /** The gun's muzzle, where the beam leaves, off the right forearm — its `+x` is up whilst aiming — in model units */
  beamFrom: gunMuzzle,
  /** How far down the forearm the hand holds it, which it fades into and out of — model units */
  grip: 0.29,
  fadeSecs: 0.3,
  /** Sat, the gun shrinks into the hand over the last of the arm's way down, as this much of its blend */
  handBlend: 0.25,
  /** Seconds the arm takes to swing most of the way onto a new point, sat or lain — see `glideArmAt` */
  armGlideSecs: 0.15,
  /** Radians off where it is headed the arm counts as aimed, though it eases on — see `glideArmAt` */
  armAimedRad: Math.PI / 60,
  /** Radians a detent tilts it, and seconds it eases there over */
  tiltRad: (8 * Math.PI) / 180,
  tiltSecs: 0.12,
  /** Radians of pitch past which the arm aims fully along it: level, the pose's own */
  pitchFullRad: 0.02,
  /** Radians off a part an aim at it, not held, is let go of. Or after `aimSecs` */
  aimedRad: 0.005,
  /** Radians the muzzle's line may pass off whom it locks on to */
  lockRad: 0.06,
  aimSecs: 1.5,
  /** Metres a miss looks along for a wall, and runs on past them until it finds one */
  passMax: 12,
  passStub: 1,
  /** Seconds a shot lasts, before they let go of their target */
  fireSecs: 1.5,
  /** Metres a shot at no one reaches at most: a geomorph's width (1200 sgu) */
  alongMax: 30,
  /** Metres up a shotgun's rays are cast at, wanting an aim */
  castY: 1,
  /** Seconds a one-off shot may take before it is lowered regardless, e.g. never in sight */
  onceSecs: 4,
  /** Radians about the right forearm between an arm at rest and the pose's — see `gunRoll` */
  restRoll: Math.PI / 2,
  /** Seconds they stay drawn in at least — longer whilst something stays in reach */
  holdSecs: 0.5,
  drawInSecs: 0.3,
  /** Seconds to draw in crouched: the gun drops with them, and is nearer what it meets */
  quickDrawInSecs: 0.12,
  /** Seconds to draw in by a wall, door or obstacle: the gun may be in it already */
  wallDrawInSecs: 0.11,
  /** An arm put at rest at once, e.g. on a respawn */
  snapSecs: 0.01,
  /** Seconds the arm takes to come down, rested lain */
  lainLowerSecs: 0.8,
  /** Seconds back out to the aim, once clear */
  drawOutSecs: 0.2,
  /** Seconds between raycasts at most, and only once they, their target or a door has changed */
  sampleSecs: 0.1,
  /** Seconds between looks for someone in the way of an npc's arm, sat or lain: the player's are `sampleSecs` apart */
  npcPollSecs: 0.3,
  /** Metres moved, or radians turned, that call for another raycast */
  recastMoved: 0.05,
  recastTurned: 0.05,
  /** Game seconds to a full charge, and to drain one cancelled */
  chargeSecs: 1.2,
  coolSecs: 1,
  /** Charged full, the gun shakes this many metres and radians, this many times a second: draining, it sputters */
  shakeM: 0.0025,
  shakeRad: 0.025,
  shakeHz: 13,
  sputterHz: 6,
} as const;

/** The arm's next pose towards `goal`, never straight between rest and the aim: by `avoid`, and on once that is in */
export function byAvoid(goal: null | AnimationClipKey, shown: null | AnimationClipKey, settled: boolean) {
  const crossing = goal !== shown && goal !== phaserConfig.avoid && (shown === null || shown === phaserConfig.pose);
  return crossing || (shown === phaserConfig.avoid && settled === false) ? phaserConfig.avoid : goal;
}

/** A charge's level at game `now`, `0` to `1` over `chargeSecs`: `0` for none */
export function levelOf(charge: undefined | ArmEntry["charge"], now: number) {
  return charge == null ? 0 : Math.min(1, (now - charge.since) / phaserConfig.chargeSecs);
}

/** Lowers it, forgetting whom it was on or pointed at: raised again, it is on nobody. `true` if it was raised */
export function lower(arm: ArmEntry) {
  const raised = arm.armed;
  Object.assign(arm, {
    armed: false,
    target: null,
    toward: null,
    pointAt: null,
    tilt: 0,
    aimAt: null,
    pitchAt: null,
    charge: null,
    cool: null,
    steady: false,
  });
  return raised;
}

/** Faded right out, mid-teleport: in their hand until then, and again as they fade back in */
export const leaving = (npc: Npc) => npc.colorScale.value === 0;

/** Ours to clear: never another's upper pose e.g. psi's hands */
export const isPhaserPose = (key: null | string) => key === phaserConfig.pose || key === phaserConfig.avoid;

/** Turns them not at all, at `rate` `0`, but is an aim: a move strafes */
export const heldAim = { at: 0, rate: 0, untilRest: false };

/** Their right forearm, found once per model: by name it is a search of their whole skeleton */
export function handOf(npc: Npc, arm: ArmEntry) {
  if (arm.hand?.of !== npc.group) {
    const bone = npc.group?.getObjectByName("rightforearm");
    arm.hand = bone === undefined ? null : { of: npc.group, bone };
  }
  return arm.hand?.bone ?? null;
}

/**
 * Radians to roll the gun back about the forearm, which is rolled a quarter turn in our pose alone: undone by
 * however much it is NOT, so the gun never turns about its barrel as the arm comes up or down
 */
export function gunRoll(npc: Npc, hand: THREE.Object3D) {
  const { upper } = npc.anim;
  const { restRoll } = phaserConfig;
  // drawn in, by the blend instead
  if (upper.key === phaserConfig.avoid) return (1 - eased(upper.blend)) * restRoll;
  const twist = 2 * Math.atan2(hand.quaternion.y, hand.quaternion.w);
  return THREE.MathUtils.clamp(restRoll - Math.abs(deltaAngle(0, twist)), 0, restRoll);
}

export const muzzle = new THREE.Vector3(...phaserConfig.beamFrom);

/** The bones a shot may meet: those of a hit region */
export const hitBones = Object.keys(hitConfig.region);

const tmpShoulder = new THREE.Vector3();
const tmpLock = new THREE.Vector3();
const tmpLockAt = { x: 0, y: 0 };
const tmpTip = new THREE.Vector3();
const tmpAlong = new THREE.Vector3();
