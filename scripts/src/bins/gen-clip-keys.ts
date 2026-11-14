#!/usr/bin/env node

/**
 * Re-keys clips of the npc model from code, for motion that is solved rather than posed e.g. a stance
 * whose feet stay planted. Writes `current.bbmodel` AND bakes the same into `current.gltf`, as Blockbench
 * would export it, so neither need be open. Each of `clips` below is one recipe, with its own parameters
 * ```sh
 * gen-clip-keys                          # every recipe
 * gen-clip-keys sit                      # one
 * gen-clip-keys sit knee=70 phaser_aim rock=0.6 drop=0.4
 * ```
 * It drops whatever of the glTF's buffer is no longer used, so a re-run needs no restore
 */

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path/posix";
import * as THREE from "three";
import { PROJECT_ROOT } from "../const.ts";

const dir = join(PROJECT_ROOT, "packages/media/src/blockbench/current");
const gltf = JSON.parse(readFileSync(join(dir, "current.gltf"), "utf8"));
const bbmodel = JSON.parse(readFileSync(join(dir, "current.bbmodel"), "utf8"));

//#region the rig, and what a recipe is made of

type Triple = [number, number, number];
type Side = "left" | "right";
const sides: Side[] = ["left", "right"];
/** A bone's channel over a clip: degrees, or model units off its rest. `keys` are the times Blockbench is given */
type Track = { clip: string; bone: string; channel: "rotation" | "position"; keys: number[]; at(t: number): Triple };
/**
 * What re-keys a clip, or a few that share a pose: `params` are its defaults, each settable as `name=value`.
 * `bases` are the clips it makes afresh, each a copy of its base clip that the tracks then re-key
 */
type Recipe<P extends Record<string, number>> = {
  params: P;
  tracks(params: P): Track[];
  bases?: Record<string, string>;
};

/** Every clip is this long, bar a gait, at this many frames a second */
const length = 2.5;
const fps = 24;
/** The frames of a clip `secs` long, ends included */
const framesOf = (secs: number) => Array.from({ length: Math.round(secs * fps) + 1 }, (_, i) => i / fps);
const frames = framesOf(length);
/** The times a posed channel is keyed at: the ends of the cycle, and halfway */
const thirds = [0, length / 2, length];
/** Every fifth frame: enough for a spline through them to hold a solved foot still */
const dense = frames.filter((_, i) => i % 5 === 0);
/** `0` at the ends of a cycle, `1` halfway: the breath's phase */
const swell = (t: number) => (1 - Math.cos((2 * Math.PI * t) / length)) / 2;
/** From `a` at the ends of the cycle to `b` halfway, as the breath goes */
const breathe = (a: number, b: number) => (t: number) => a + (b - a) * swell(t);

/** As Blockbench: a mesh's Euler is `ZYX`, the keyframe's degrees unnegated */
const euler = ([x, y, z]: Triple) => {
  const { degToRad } = THREE.MathUtils;
  return new THREE.Euler(degToRad(x), degToRad(y), degToRad(z), "ZYX");
};
/** A bone's offset from its parent at rest, in model units: 16 to the glTF's one */
const rest = (bone: string) =>
  new THREE.Vector3()
    .fromArray(gltf.nodes.find((n: { name: string }) => n.name === bone).translation as Triple)
    .multiplyScalar(16);

/** A rotation track, posed: keyed at `thirds` unless told otherwise */
const turn = (clip: string, bone: string, at: Track["at"], keys = thirds): Track => ({
  clip,
  bone,
  channel: "rotation",
  keys,
  at,
});

/** Catmull-Rom through `[frame, value]`s, as Blockbench eases its own keys: held past the last */
const through = (keyed: [number, Triple][]) => (t: number) => {
  const at = (i: number) => keyed[Math.max(0, Math.min(keyed.length - 1, i))][1];
  const i = keyed.findLastIndex(([frame]) => frame / fps <= t);
  if (i >= keyed.length - 1) return at(i);
  const u = (t * fps - keyed[i][0]) / (keyed[i + 1][0] - keyed[i][0]);
  return at(i).map((p1, c) => {
    const [p0, p2, p3] = [at(i - 1)[c], at(i + 1)[c], at(i + 2)[c]];
    return (
      0.5 * (2 * p1 + (p2 - p0) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u ** 2 + (3 * p1 - p0 - 3 * p2 + p3) * u ** 3)
    );
  }) as Triple;
};

/** A leg as posed: its thigh's rotation and its shin's `x`. The sole is flat when thigh, shin and foot `x` sum to nought */
type Leg = { thigh: Triple; shinX: number };

/** A leg's ankle, with the root there and its thigh and shin turned to those `x` */
function ankleOf(side: Side, { thigh: [, y, z] }: Leg, root: Triple, thighX: number, shinX: number) {
  const thigh = new THREE.Quaternion().setFromEuler(euler([thighX, y, z]));
  const shin = thigh.clone().multiply(new THREE.Quaternion().setFromEuler(euler([shinX, 0, 0])));
  return new THREE.Vector3(...root)
    .add(rest(`${side}thigh`))
    .add(rest(`${side}shin`).applyQuaternion(thigh))
    .add(rest(`${side}foot`).applyQuaternion(shin));
}

/**
 * The root and legs of `clips` with both feet planted: the root goes where `rootAt` says, and each leg is
 * solved so its ankle stays at `feet` and its sole flat. Throws where a leg cannot reach
 */
function plantedLegs(
  clips: string[],
  rootAt: (t: number) => Triple,
  legs: Record<Side, Leg>,
  feet: Record<Side, THREE.Vector3>,
  keys = dense,
): Track[] {
  /** `[thigh, shin, foot]` `x` of `side` with the root there */
  const solve = (side: Side, root: Triple): Triple => {
    const miss = (thigh: number, shin: number) => ankleOf(side, legs[side], root, thigh, shin).sub(feet[side]);
    let [thigh, shin] = [legs[side].thigh[0], legs[side].shinX];
    // Newton on the ankle's height and depth: two angles, two residuals
    for (let i = 0; i < 20; i++) {
      const off = miss(thigh, shin);
      if (Math.hypot(off.y, off.z) < 1e-6) break;
      const dThigh = miss(thigh + 0.01, shin)
        .sub(off)
        .divideScalar(0.01);
      const dShin = miss(thigh, shin + 0.01)
        .sub(off)
        .divideScalar(0.01);
      const det = dThigh.y * dShin.z - dShin.y * dThigh.z;
      thigh -= (off.y * dShin.z - dShin.y * off.z) / det;
      shin -= (dThigh.y * off.z - off.y * dThigh.z) / det;
    }
    const off = miss(thigh, shin);
    if (!(Math.hypot(off.y, off.z) < 1e-4) || shin > -2 || shin < -170) {
      throw Error(`${clips[0]}: the ${side} leg cannot reach its foot with the root at ${root}`);
    }
    return [thigh, shin, -(thigh + shin)];
  };
  return clips.flatMap((clip) => [
    { clip, bone: "skeleton-root", channel: "position" as const, keys, at: rootAt },
    ...sides.flatMap((side) => {
      const [, y, z] = legs[side].thigh;
      return [
        turn(clip, `${side}thigh`, (t) => [solve(side, rootAt(t))[0], y, z], keys),
        turn(clip, `${side}shin`, (t) => [solve(side, rootAt(t))[1], 0, 0], keys),
        turn(clip, `${side}foot`, (t) => [solve(side, rootAt(t))[2], 0, 0], keys),
      ];
    }),
  ]);
}

/** A still pose's one key */
const still = [0];

/** Degrees a leg's solve may move it in one Newton step */
const maxStep = 20;

/** A gait's cycle, in seconds: every frame keyed, as `walk` is */
const gaitLength = 1;
const gaitFrames = framesOf(gaitLength);

/**
 * The legs of `clip` stepping: the root where `rootAt` says, and each ankle on its path `feet`. Each thigh's swing, its
 * sideways move, and its knee are solved to reach it. Throws where a leg cannot reach. See `StepOpts`
 */
function steppingLegs(
  clip: string,
  rootAt: (t: number) => Triple,
  feet: Record<Side, (t: number) => THREE.Vector3>,
  { keys = gaitFrames, toeOut = 0, pitchOf, abduct = false }: StepOpts = {},
): Track[] {
  /** A thigh's rotation: swung `x`, then moved sideways by `side` degrees */
  const thighOf = (x: number, side: number): Triple => (abduct ? [x, 0, side] : [x, side, 0]);
  const solved = new Map<string, [Triple, Triple, Triple]>();
  /** Each leg's last solution, which the next sets out from: from a fixed guess a leg can jump to another branch */
  const last: Record<Side, Triple> = { left: [90, 0, -130], right: [90, 0, -130] };
  /** `[thigh, shin, foot]` rotations of `side` at `t` */
  const solve = (side: Side, t: number) => {
    const key = `${side} ${t}`;
    const cached = solved.get(key);
    if (cached !== undefined) return cached;
    const root = rootAt(t);
    const want = feet[side](t);
    const ankle = ([x, y, shin]: Triple) => {
      const thigh = new THREE.Quaternion().setFromEuler(euler(thighOf(x, y)));
      const knee = thigh.clone().multiply(new THREE.Quaternion().setFromEuler(euler([shin, 0, 0])));
      return new THREE.Vector3(...root)
        .add(rest(`${side}thigh`))
        .add(rest(`${side}shin`).applyQuaternion(thigh))
        .add(rest(`${side}foot`).applyQuaternion(knee));
    };
    // Newton on the ankle's three coordinates: the thigh's swing, its sideways move, and the knee
    let v: Triple = [...last[side]];
    for (let i = 0; i < 50; i++) {
      const off = ankle(v).sub(want);
      if (off.length() < 1e-6) break;
      const columns = [0, 1, 2].map((c) => {
        const nudged = [...v] as Triple;
        nudged[c] += 0.01;
        return ankle(nudged).sub(want).sub(off).divideScalar(0.01);
      });
      const jacobian = new THREE.Matrix3().set(
        columns[0].x,
        columns[1].x,
        columns[2].x,
        columns[0].y,
        columns[1].y,
        columns[2].y,
        columns[0].z,
        columns[1].z,
        columns[2].z,
      );
      const step = off.applyMatrix3(jacobian.invert());
      // at most `maxStep` degrees a step, so it never leaps onto another branch
      const scale = Math.min(1, maxStep / Math.max(Math.abs(step.x), Math.abs(step.y), Math.abs(step.z)));
      v = [v[0] - step.x * scale, v[1] - step.y * scale, v[2] - step.z * scale];
    }
    if (!(ankle(v).distanceTo(want) < 1e-4) || v[2] > -2 || v[2] < -170 || Math.abs(v[1]) > 60) {
      const [x, out, shin] = v.map((d) => d.toFixed(1));
      throw Error(`${clip}: the ${side} leg cannot reach its foot at ${t}s (thigh x ${x}, out ${out}, shin ${shin})`);
    }
    // the foot undoes the leg's turn, so the sole is flat, then turns its toes out by `toeOut`
    const leg = new THREE.Quaternion()
      .setFromEuler(euler(thighOf(v[0], v[1])))
      .multiply(new THREE.Quaternion().setFromEuler(euler([v[2], 0, 0])));
    const pitch = pitchOf?.[side](t) ?? 0; // `+` lifts the toes
    const out = new THREE.Quaternion().setFromEuler(euler([pitch, side === "left" ? toeOut : -toeOut, 0]));
    const foot = new THREE.Euler().setFromQuaternion(leg.invert().multiply(out), "ZYX");
    const { radToDeg } = THREE.MathUtils;
    const result: [Triple, Triple, Triple] = [
      thighOf(v[0], v[1]),
      [v[2], 0, 0],
      [radToDeg(foot.x), radToDeg(foot.y), radToDeg(foot.z)],
    ];
    solved.set(key, result);
    last[side] = v;
    return result;
  };
  return [
    { clip, bone: "skeleton-root", channel: "position", keys, at: rootAt },
    ...sides.flatMap((side) =>
      (["thigh", "shin", "foot"] as const).map((bone, i) =>
        turn(clip, `${side}${bone}`, (t) => solve(side, t)[i], keys),
      ),
    ),
  ];
}

/**
 * An ankle's path over a gait's cycle, in model units off `home`. It lands ahead along `along`, the way they go,
 * at `phase`. Planted for `duty` of the cycle, it slides back as the body goes on, then lifts `lift` and swings ahead
 */
function stepping(
  home: THREE.Vector3,
  along: THREE.Vector3,
  p: { stride: number; duty: number; lift: number },
  phase: number,
) {
  return (t: number) => {
    const u = (((t / gaitLength - phase) % 1) + 1) % 1;
    const half = (p.stride * p.duty) / 2;
    if (u < p.duty) return home.clone().addScaledVector(along, half - (2 * half * u) / p.duty);
    const s = (u - p.duty) / (1 - p.duty);
    return home
      .clone()
      .addScaledVector(along, -half + 2 * half * THREE.MathUtils.smoothstep(s, 0, 1))
      .setY(home.y + p.lift * Math.sin(Math.PI * s));
  };
}

type StepOpts = {
  /** The times keyed */
  keys?: number[];
  /** Degrees each foot's toes turn out */
  toeOut?: number;
  /** Each foot's pitch over time, in degrees: `+` lifts the toes */
  pitchOf?: Record<Side, (t: number) => number>;
  /** Move each leg sideways by swinging it out at the hip (`z`), not by turning the thigh (`y`) */
  abduct?: boolean;
};

/** A foot's pitch over a gait's cycle, landing at `phase`: struck on the heel, rolled flat, then off the toe */
function heelToe(p: { duty: number; heel: number; toe: number }, phase: number) {
  const { smoothstep } = THREE.MathUtils;
  return (t: number) => {
    const u = (((t / gaitLength - phase) % 1) + 1) % 1;
    const roll = 0.25 * p.duty;
    if (u < p.duty) return p.heel * (1 - smoothstep(u, 0, roll)) - p.toe * smoothstep(u, p.duty - roll, p.duty);
    return -p.toe + (p.toe + p.heel) * smoothstep((u - p.duty) / (1 - p.duty), 0, 1);
  };
}

/** Model units an ankle rises so its foot, pitched `degrees`, keeps its heel or toe on the floor */
function rockerLift(degrees: number) {
  const a = THREE.MathUtils.degToRad(degrees);
  const { below, heel, toe } = footSole;
  const lowest = Math.min(-below * Math.cos(a) - heel * Math.sin(a), -below * Math.cos(a) + toe * Math.sin(a));
  return Math.max(0, -below - lowest);
}

/** The sole about the ankle, in model units: how far below it, and how far back to the heel and on to the toe */
const footSole = { below: 1.25, heel: 1.6, toe: 0.9 };

/** Where each ankle rests, stood */
const restAnkles = () => {
  const upright: Leg = { thigh: [0, 0, 0], shinX: 0 };
  return Object.fromEntries(sides.map((side) => [side, ankleOf(side, upright, [0, 0, 0], 0, 0)])) as Record<
    Side,
    THREE.Vector3
  >;
};

/** `tracks` mirrored as `clip`: left and right bones swapped, rotation `y` and `z` and position `x` negated */
function mirrored(tracks: Track[], clip: string): Track[] {
  const swap = (bone: string) =>
    bone.startsWith("left") ? `right${bone.slice(4)}` : bone.startsWith("right") ? `left${bone.slice(5)}` : bone;
  return tracks.map((track) => ({
    ...track,
    clip,
    bone: swap(track.bone),
    at: (t: number) => {
      const [x, y, z] = track.at(t);
      return track.channel === "rotation" ? [x, -y, -z] : [-x, y, z];
    },
  }));
}

/** A crouched gait's torso, head and forearms, all still: the torso leant `lean`, the head level */
function crouchedUpper(clip: string, lean: number, foreX = 40) {
  return [
    turn(clip, "stomach", () => [-lean / 2, 0, 0], still),
    turn(clip, "chest", () => [-lean / 2, 0, 0], still),
    turn(clip, "head", () => [lean, 0, 0], still),
    turn(clip, "rightforearm", () => [foreX, 0, -10], still),
    turn(clip, "leftforearm", () => [foreX, 0, 10], still),
  ];
}

/** The legs of a crouch: the feet set out `splay` either side, toes out `toeOut`, the root where `rootAt` says, knees out */
function splayedLegs(clip: string, rootAt: (t: number) => Triple, splay: number, toeOut: number) {
  const feet = restAnkles();
  feet.left.x -= splay;
  feet.right.x += splay;
  return steppingLegs(clip, rootAt, { left: () => feet.left, right: () => feet.right }, { keys: dense, toeOut });
}

/** The legs of a squat, the feet where they stand at rest and the hips `down` and `back` */
function squatLegs(clip: string, down: number, back: number) {
  const upright: Record<Side, Leg> = {
    left: { thigh: [0, 0, 0], shinX: 0 },
    right: { thigh: [0, 0, 0], shinX: 0 },
  };
  const [left, right] = sides.map((side) => ankleOf(side, upright[side], [0, 0, 0], 0, 0));
  /** Where the solve sets out from: knees well bent */
  const bent: Record<Side, Leg> = {
    left: { thigh: [90, 0, 0], shinX: -130 },
    right: { thigh: [90, 0, 0], shinX: -130 },
  };
  return plantedLegs([clip], () => [0, -down, back], bent, { left, right }, still);
}

//#endregion

//#region the recipes

const recipe = <P extends Record<string, number>>(r: Recipe<P>) => r;

/**
 * A squat behind cover, to rise from, breathing: the feet planted, the torso leant `lean`, the head level, the arms
 * posed. Breathing in, the torso straightens `breathe` degrees, the chest rises `rise` and the hips `bob`
 */
const crouchStill = (
  clip: string,
  params: Record<
    "down" | "back" | "lean" | "splay" | "toeOut" | "breathe" | "rise" | "bob" | "armX" | "armZ" | "foreX" | "foreZ",
    number
  >,
) =>
  recipe({
    params,
    tracks(p) {
      const lean = breathe(p.lean, p.lean - p.breathe);
      // the arms are the chest's: each keeps its pitch in the world as the torso breathes
      const armX = (t: number) => p.armX - p.lean + lean(t);
      return [
        ...splayedLegs(clip, (t) => [0, -p.down + breathe(0, p.bob)(t), p.back], p.splay, p.toeOut),
        turn(clip, "stomach", (t) => [-lean(t) / 2, 0, 0]),
        turn(clip, "chest", (t) => [-lean(t) / 2, 0, 0]),
        { clip, bone: "chest", channel: "position", keys: thirds, at: (t) => [0, breathe(0, p.rise)(t), 0] },
        turn(clip, "head", (t) => [lean(t), 0, 0]),
        turn(clip, "rightarm", (t) => [armX(t), 0, p.armZ]),
        turn(clip, "rightforearm", () => [p.foreX, 0, p.foreZ], still),
        turn(clip, "leftarm", (t) => [armX(t), 0, -p.armZ]),
        turn(clip, "leftforearm", () => [p.foreX, 0, -p.foreZ], still),
      ];
    },
  });

/**
 * A crouch walking ahead: the hips swaying over the planted foot, the arms forward. Flat-footed, unless struck on the
 * `heel` and rolled off the `toe` (degrees)
 */
const crouchWalk = (
  clip: string,
  params: Record<
    | "down"
    | "back"
    | "lean"
    | "splay"
    | "toeOut"
    | "stride"
    | "duty"
    | "lift"
    | "sway"
    | "bob"
    | "swing"
    | "heel"
    | "toe"
    | "armOut"
    | "foreX"
    | "abduct",
    number
  >,
) =>
  recipe({
    params,
    tracks(p) {
      const feet = restAnkles();
      feet.left.x -= p.splay;
      feet.right.x += p.splay;
      const ahead = new THREE.Vector3(0, 0, -1); // a foot plants ahead, and slides back
      /** The left foot lands at the start, the right half a cycle on */
      const swayAt = (t: number) => -p.sway * Math.cos(2 * Math.PI * (t / gaitLength - p.duty / 2));
      const armSwing = (t: number) => p.swing * Math.cos(2 * Math.PI * (t / gaitLength));
      const pitchOf = { left: heelToe(p, 0), right: heelToe(p, 0.5) };
      /** Each ankle on its path, raised as its foot rolls so the heel or toe stays down */
      const footAt = (side: Side, phase: number) => {
        const path = stepping(feet[side], ahead, p, phase);
        return (t: number) => path(t).setY(path(t).y + rockerLift(pitchOf[side](t)));
      };
      return [
        ...steppingLegs(
          clip,
          (t) => [swayAt(t), -p.down + p.bob * Math.cos(4 * Math.PI * (t / gaitLength)), p.back],
          { left: footAt("left", 0), right: footAt("right", 0.5) },
          { toeOut: p.toeOut, pitchOf, abduct: p.abduct === 1 },
        ),
        ...crouchedUpper(clip, p.lean, p.foreX),
        // the arm opposite the leading foot comes forward
        turn(clip, "rightarm", (t) => [p.lean + p.armOut + armSwing(t), 0, 6], gaitFrames),
        turn(clip, "leftarm", (t) => [p.lean + p.armOut - armSwing(t), 0, -6], gaitFrames),
      ];
    },
  });

/** A crouch stepping to their right: the right foot leads, the left closes up behind it */
const crouchStrafeRight = (
  clip: string,
  params: Record<
    "down" | "back" | "lean" | "splay" | "toeOut" | "stride" | "duty" | "lift" | "bob" | "abduct" | "armOut" | "foreX",
    number
  >,
) =>
  recipe({
    params,
    tracks(p) {
      const feet = restAnkles();
      feet.left.x -= p.splay;
      feet.right.x += p.splay;
      const toRight = new THREE.Vector3(1, 0, 0); // their right is `+x`
      const left = stepping(feet.left, toRight, p, 0.5);
      const rightFoot = stepping(feet.right, toRight, p, 0);
      // a foot is about 2 wide
      const gap = Math.min(...gaitFrames.map((t) => rightFoot(t).x - left(t).x));
      if (gap < 2.2) throw Error(`${clip}: the ankles come within ${gap.toFixed(2)} of each other`);
      return [
        ...steppingLegs(
          clip,
          (t) => [0, -p.down + p.bob * Math.cos(4 * Math.PI * (t / gaitLength)), p.back],
          { left, right: rightFoot },
          { toeOut: p.toeOut, abduct: p.abduct === 1 },
        ),
        ...crouchedUpper(clip, p.lean, p.foreX),
        turn(clip, "rightarm", () => [p.lean + p.armOut, 0, 8], [0]),
        turn(clip, "leftarm", () => [p.lean + p.armOut, 0, -8], [0]),
      ];
    },
  });

/** `src` played backwards as `clip`, as `backwards` is `walk`: the same feet, reversed */
const reversedOf = (clip: string, src: Recipe<Record<string, number>>) =>
  recipe({
    params: {},
    tracks: () =>
      src.tracks({ ...src.params }).map((track) => ({ ...track, clip, at: (t: number) => track.at(gaitLength - t) })),
  });

/** `src` mirrored as `clip` */
const mirroredOf = (clip: string, src: Recipe<Record<string, number>>) =>
  recipe({ params: {}, tracks: () => mirrored(src.tracks({ ...src.params }), clip) });

/** The full crouch's, and the half crouch's: moving, a sneak. Arms searched: elbows on knees, hands on knees */
const crouchClips = {
  crouch_cover: crouchStill("crouch_cover", {
    down: 8.5,
    back: 3,
    lean: 40,
    splay: 1.5,
    toeOut: 20,
    breathe: 3,
    rise: 0.15,
    bob: 0.15,
    armX: 40,
    armZ: 10,
    foreX: 70,
    foreZ: -40,
  }),
  crouch_walk: crouchWalk("crouch_walk", {
    down: 8.5,
    back: 3,
    lean: 40,
    splay: 1.5,
    toeOut: 20,
    stride: 8,
    duty: 0.6,
    lift: 1.5,
    sway: 0.4,
    bob: 0.3,
    swing: 8,
    heel: 0,
    toe: 0,
    armOut: 20,
    foreX: 40,
    abduct: 0,
  }),
  crouch_strafe_right: crouchStrafeRight("crouch_strafe_right", {
    down: 8.5,
    back: 3,
    lean: 40,
    splay: 1.5,
    toeOut: 20,
    stride: 5,
    duty: 0.6,
    lift: 1.2,
    bob: 0.3,
    abduct: 0,
    armOut: 20,
    foreX: 40,
  }),
  crouch_half: crouchStill("crouch_half", {
    down: 4,
    back: 1.5,
    lean: 32,
    splay: 1,
    toeOut: 15,
    breathe: 3,
    rise: 0.15,
    bob: 0.15,
    armX: -5,
    armZ: 12,
    foreX: 70,
    foreZ: -50,
  }),
  crouch_half_walk: crouchWalk("crouch_half_walk", {
    down: 2.5,
    back: 1,
    lean: 18,
    splay: 0.3,
    toeOut: 5,
    stride: 8,
    duty: 0.65,
    lift: 1.2,
    sway: 0.15,
    bob: 0.4,
    swing: 10,
    heel: 10,
    toe: 15,
    armOut: 5,
    foreX: 15,
    abduct: 1,
  }),
  crouch_half_strafe_right: crouchStrafeRight("crouch_half_strafe_right", {
    down: 2.5,
    back: 1,
    lean: 18,
    splay: 0.3,
    toeOut: 5,
    stride: 5,
    duty: 0.55,
    lift: 1,
    bob: 0.3,
    abduct: 1,
    armOut: 5,
    foreX: 15,
  }),
};

//#endregion

//#region fidgets: a rest clip, its arms and head moving once a cycle

/** The skinned mesh's box over every frame of `clip`, leaving out the vertices on bone `skip` */
function boxOf(clip: string, buffer: Buffer, skip?: string): THREE.Box3 {
  const nodes: THREE.Object3D[] = gltf.nodes.map((n: { name: string; translation?: Triple; rotation?: number[] }) => {
    const o = new THREE.Object3D();
    o.name = n.name;
    if (n.translation !== undefined) o.position.fromArray(n.translation);
    if (n.rotation !== undefined) o.quaternion.fromArray(n.rotation);
    return o;
  });
  gltf.nodes.forEach((n: { children?: number[] }, i: number) => n.children?.forEach((c) => nodes[i].add(nodes[c])));
  const animation = gltf.animations.find((a: { name: string }) => a.name === clip);
  const channels = animation.channels.map((c: any) => ({
    node: nodes[c.target.node],
    path: c.target.path as string,
    times: rowsOf(buffer, animation.samplers[c.sampler].input).map(([t]) => t),
    values: rowsOf(buffer, animation.samplers[c.sampler].output),
  }));
  const [primitive] = gltf.meshes[0].primitives;
  const skin = gltf.skins[0];
  const positions = rowsOf(buffer, primitive.attributes.POSITION);
  const joints = rowsOf(buffer, primitive.attributes.JOINTS_0);
  const inverses = rowsOf(buffer, skin.inverseBindMatrices).map((m) => new THREE.Matrix4().fromArray(m));
  /** Each vertex's joint: Blockbench binds each to one bone */
  const jointOf = rowsOf(buffer, primitive.attributes.WEIGHTS_0).map((w, i) => joints[i][w.indexOf(Math.max(...w))]);
  const root = nodes[gltf.scenes[0].nodes[0]];
  const [box, at, matrix] = [new THREE.Box3(), new THREE.Vector3(), new THREE.Matrix4()];
  for (const t of framesOf(secsOf(clip))) {
    for (const { node, path, times, values } of channels) {
      const i = Math.max(
        0,
        times.findLastIndex((s: number) => s <= t),
      );
      const j = Math.min(i + 1, times.length - 1);
      const u = j === i ? 0 : Math.min(1, (t - times[i]) / (times[j] - times[i]));
      if (path === "rotation")
        node.quaternion.fromArray(values[i]).slerp(new THREE.Quaternion().fromArray(values[j]), u);
      else node.position.fromArray(values[i]).lerp(new THREE.Vector3().fromArray(values[j]), u);
    }
    root.updateMatrixWorld(true);
    positions.forEach((p, i) => {
      const bone = nodes[skin.joints[jointOf[i]]];
      if (bone.name === skip) return;
      box.expandByPoint(at.fromArray(p).applyMatrix4(matrix.multiplyMatrices(bone.matrixWorld, inverses[jointOf[i]])));
    });
  }
  return box;
}

/** The glTF's buffer as read, which holds every clip a fidget is based on */
const readBuffer = Buffer.from(gltf.buffers[0].uri.split(",")[1], "base64");
/** A clip's length, as the bbmodel has it */
const secsOf = (clip: string): number => bbmodel.animations.find((a: { name: string }) => a.name === clip).length;
/** Degrees as Blockbench keys them */
const quatOf = (deg: Triple) => new THREE.Quaternion().setFromEuler(euler(deg));
const degOf = (q: THREE.Quaternion): Triple => {
  const e = new THREE.Euler().setFromQuaternion(q, "ZYX");
  return [e.x, e.y, e.z].map(THREE.MathUtils.radToDeg) as Triple;
};

/** A bone's rotation in a glTF clip at `t`, as the game samples it */
function turnIn(clip: string, bone: string): (t: number) => THREE.Quaternion {
  const animation = gltf.animations.find((a: { name: string }) => a.name === clip);
  const node = gltf.nodes.findIndex((n: { name: string }) => n.name === bone);
  const channel = animation.channels.find((c: any) => c.target.node === node && c.target.path === "rotation");
  if (channel === undefined) return () => new THREE.Quaternion();
  const { input, output } = animation.samplers[channel.sampler];
  const [times, quats] = [rowsOf(readBuffer, input), rowsOf(readBuffer, output)];
  return (t) => {
    const i = Math.max(
      0,
      times.findLastIndex(([at]) => at <= t),
    );
    if (i >= times.length - 1) return new THREE.Quaternion().fromArray(quats[times.length - 1]);
    const u = (t - times[i][0]) / (times[i + 1][0] - times[i][0]);
    return new THREE.Quaternion().fromArray(quats[i]).slerp(new THREE.Quaternion().fromArray(quats[i + 1]), u);
  };
}

/** A bone's position in a glTF clip at `t`: model units off its rest, as a position key is */
function offsetIn(clip: string, bone: string): (t: number) => Triple {
  const animation = gltf.animations.find((a: { name: string }) => a.name === clip);
  const node = gltf.nodes.findIndex((n: { name: string }) => n.name === bone);
  const channel = animation.channels.find((c: any) => c.target.node === node && c.target.path === "translation");
  if (channel === undefined) return () => [0, 0, 0];
  const { input, output } = animation.samplers[channel.sampler];
  const [times, at] = [rowsOf(readBuffer, input), rowsOf(readBuffer, output)];
  return (t) => {
    const i = Math.max(
      0,
      times.findLastIndex(([s]) => s <= t),
    );
    const j = Math.min(i + 1, times.length - 1);
    const u = j === i ? 0 : Math.min(1, (t - times[i][0]) / (times[j][0] - times[i][0]));
    const v = new THREE.Vector3().fromArray(at[i]).lerp(new THREE.Vector3().fromArray(at[j]), u);
    return v.multiplyScalar(16).sub(rest(bone)).toArray();
  };
}

/** An accessor's rows, read from `buffer` */
function rowsOf(buffer: Buffer, accessor: number): number[][] {
  const a = gltf.accessors[accessor];
  const view = gltf.bufferViews[a.bufferView];
  const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type as string] as number;
  const Kind = { 5126: Float32Array, 5125: Uint32Array, 5123: Uint16Array, 5121: Uint8Array }[
    a.componentType as number
  ] as Float32ArrayConstructor;
  const stride = view.byteStride === undefined ? width : view.byteStride / Kind.BYTES_PER_ELEMENT;
  const offset = buffer.byteOffset + (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const all = new Kind(buffer.buffer.slice(offset, offset + ((a.count - 1) * stride + width) * Kind.BYTES_PER_ELEMENT));
  return Array.from({ length: a.count }, (_, i) => Array.from(all.subarray(i * stride, i * stride + width)));
}

/** `0` to `1` and back, eased: `1` from `from` to `to`, fractions of the cycle */
const held = (u: number, from: number, to: number, ease: number) => {
  const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
  return smooth((u - from) / ease) * smooth((to - u) / ease);
};

/** A fidget's pose is held over this much of the cycle, eased in and out, so it loops on its base */
const hold = { from: 0.08, to: 0.92, ease: 0.22 };

/**
 * `clip` as `base`, each bone of `poses` turned along its path by how far the fidget is `held`: by way of each
 * pose to the last. `on` turns a bone further whilst held, given the time and that weight, e.g. a rub or a glance
 */
function fidget(
  clip: string,
  base: string,
  poses: Record<string, Triple[]>,
  on: Record<string, (t: number, weight: number) => Triple> = {},
  { over = hold, lifts = {} }: { over?: typeof hold; lifts?: Record<string, Triple> } = {},
): Track[] {
  const secs = secsOf(base);
  const keys = framesOf(secs).filter((_, i) => i % 2 === 0);
  const weight = (t: number) => held(t / secs, over.from, over.to, over.ease);
  const bones = [...new Set([...Object.keys(poses), ...Object.keys(on)])];
  const shifts = Object.entries(lifts).map(([bone, by]): Track => {
    const from = offsetIn(base, bone);
    return { clip, bone, channel: "position", keys, at: (t) => from(t).map((v, i) => v + by[i] * weight(t)) as Triple };
  });
  return shifts.concat(
    bones.map((bone) => {
      const from = turnIn(base, bone);
      const path = (poses[bone] ?? []).map(quatOf);
      return turn(
        clip,
        bone,
        (t) => {
          const along = weight(t) * path.length;
          const i = Math.min(Math.floor(along), path.length - 1);
          const q = path.length === 0 ? from(t) : (i === 0 ? from(t) : path[i - 1].clone()).slerp(path[i], along - i);
          return degOf(on[bone] === undefined ? q : q.multiply(quatOf(on[bone](t, weight(t)))));
        },
        keys,
      );
    }),
  );
}

/** A to-and-fro of `amp` at `hz`, by `weight` */
const wobble = (amp: number, hz: number, t: number, weight: number) => amp * weight * Math.sin(2 * Math.PI * hz * t);
/** An arm's poses mirrored onto the left */
const mirror = (path: Triple[]) => path.map(([x, y, z]): Triple => [x, -y, -z]);
/** A forearm's poses, bent at the elbow alone */
const bent = (path: number[]) => path.map((x): Triple => [x, 0, 0]);

/** The right hand at the chin, rubbing it, the head tipped into it */
const rubChin = (clip: string, base: string, arm: Triple[], foreX: number[]) =>
  recipe({
    params: { rub: 5, hz: 2.5, tilt: 5 },
    bases: { [clip]: base },
    tracks: ({ rub, hz, tilt }) =>
      fidget(
        clip,
        base,
        { rightarm: arm, rightforearm: bent(foreX) },
        {
          rightforearm: (t, w) => [wobble(rub, hz, t, w), 0, 0],
          head: (_, w) => [tilt * w, 0, -tilt * w],
        },
      ),
  });

/** The left forearm across the waist, the head bowed to its wrist */
const checkWrist = (clip: string, base: string, arm: Triple[], foreX: number[]) =>
  recipe({
    params: { bow: 25, aside: 5 },
    bases: { [clip]: base },
    tracks: ({ bow, aside }) =>
      fidget(
        clip,
        base,
        { leftarm: arm, leftforearm: bent(foreX) },
        {
          head: (_, w) => [-bow * w, aside * w, 0],
        },
      ),
  });

/** The head alone glances to their left, then their right */
const lookAround = (clip: string, base: string) =>
  recipe({
    params: { yaw: 35, pitch: 4 },
    bases: { [clip]: base },
    tracks: ({ yaw, pitch }) => {
      const secs = secsOf(base);
      return fidget(
        clip,
        base,
        {},
        {
          head: (t) => {
            const u = t / secs;
            const glance = held(u, 0.08, 0.48, 0.15) - held(u, 0.52, 0.92, 0.15);
            return [pitch * Math.abs(glance), yaw * glance, 0];
          },
        },
      );
    },
  });

/** Held over the whole cycle: a pose jsh `pose` eases in and holds, as `point` */
const always = { from: -1, to: 2, ease: 0.01 };

/** The right wrist held before them to be looked at, the head bowed to it: jsh `pose rob as:check_wrist` */
const wristPose = (clip: string, arm: Triple, foreX: number, bow: number) =>
  recipe({
    params: { bow },
    bases: { [clip]: "breathe" },
    tracks: (p) =>
      fidget(
        clip,
        "breathe",
        { rightarm: [arm], rightforearm: bent([foreX]) },
        { head: () => [-p.bow, 0, 0] },
        { over: always },
      ),
  });

/** Shoulders up, forearms lifted and tucked in a little, the head tipped, then down again: quicker than the rest */
const shrug = (clip: string, base: string) =>
  recipe({
    params: { lift: 0.7, fore: 15, tuck: 3, tilt: 8 },
    bases: { [clip]: base },
    tracks: ({ lift, fore, tuck, tilt }) =>
      fidget(
        clip,
        base,
        {},
        {
          rightarm: (_, w) => [0, 0, -tuck * w],
          leftarm: (_, w) => [0, 0, tuck * w],
          rightforearm: (_, w) => [fore * w, 0, 0],
          leftforearm: (_, w) => [fore * w, 0, 0],
          head: (_, w) => [0, 0, tilt * w],
        },
        { over: { from: 0.25, to: 0.75, ease: 0.12 }, lifts: { rightarm: [0, lift, 0], leftarm: [0, lift, 0] } },
      ),
  });

/** Their weight onto the right leg: the hips `shift` across and `drop`, the torso tilted back over them, the feet kept */
const shiftWeight = (clip: string) =>
  recipe({
    params: { shift: 1, drop: 0.3, tilt: 5 },
    bases: { [clip]: "breathe" },
    tracks: ({ shift, drop, tilt }) => {
      const secs = secsOf("breathe");
      const weight = (t: number) => held(t / secs, hold.from, hold.to, hold.ease);
      const root = offsetIn("breathe", "skeleton-root");
      const rootAt = (t: number): Triple => {
        const [x, y, z] = root(t);
        return [x + shift * weight(t), y - drop * weight(t), z];
      };
      const feet = restAnkles();
      return [
        turn(clip, "skeleton-root", () => [0, 0, 0], still), // planted feet need it unturned
        ...steppingLegs(
          clip,
          rootAt,
          { left: () => feet.left, right: () => feet.right },
          { keys: dense, abduct: true },
        ),
        ...fidget(
          clip,
          "breathe",
          {},
          {
            stomach: (_, w) => [0, 0, tilt * w],
            chest: (_, w) => [0, 0, tilt * w],
            head: (_, w) => [0, 0, -2 * tilt * w],
            rightarm: (_, w) => [0, 0, -2 * tilt * w], // hanging plumb
            leftarm: (_, w) => [0, 0, -2 * tilt * w],
          },
        ),
      ];
    },
  });

/** Sat, leant forward, forearms on the thighs and hands past the knees, looking ahead */
const leanForward = (clip: string) =>
  recipe({
    params: { stomach: 14, chest: 20, look: 30 },
    bases: { [clip]: "sit" },
    tracks: ({ stomach, chest, look }) =>
      fidget(
        clip,
        "sit",
        {
          rightarm: [[28, 25, 11]],
          leftarm: mirror([[28, 25, 11]]),
          rightforearm: bent([100]),
          leftforearm: bent([100]),
        },
        {
          stomach: (_, w) => [-stomach * w, 0, 0],
          chest: (_, w) => [-chest * w, 0, 0],
          head: (_, w) => [look * w, 0, 0],
        },
      ),
  });

/** Lain, a stretch: shoulders pushed down the bed and the arms straight, the legs straight and the toes pointed */
const lieStretch = (clip: string) =>
  recipe({
    params: { reach: 0.5, arms: 8, legs: 4, toes: 20, arch: 3 },
    bases: { [clip]: "lie" },
    tracks: ({ reach, arms, legs, toes, arch }) =>
      fidget(
        clip,
        "lie",
        {},
        {
          stomach: (_, w) => [arch * w, 0, 0],
          chest: (_, w) => [arch * w, 0, 0],
          rightforearm: (_, w) => [-arms * w, 0, 0],
          leftforearm: (_, w) => [-arms * w, 0, 0],
          rightthigh: (_, w) => [-legs * w, 0, 0],
          leftthigh: (_, w) => [-legs * w, 0, 0],
          rightshin: (_, w) => [legs * w, 0, 0],
          leftshin: (_, w) => [legs * w, 0, 0],
          rightfoot: (_, w) => [-toes * w, 0, 0],
          leftfoot: (_, w) => [-toes * w, 0, 0],
        },
        { over: { from: 0.1, to: 0.9, ease: 0.3 }, lifts: { rightarm: [0, -reach, 0], leftarm: [0, -reach, 0] } },
      ),
  });

/**
 * Arm poses searched to reach their mark inside the base clip's box, clear of the body. Each goes by way of its
 * first pose, else the forearm swings out level in front or through the torso. A `wristPose` is eased in straight,
 * so its pose was searched for a clear straight path from rest, and between the two
 */
const fidgetClips = {
  rub_chin: rubChin(
    "rub_chin",
    "breathe",
    [
      [0, 0, 10],
      [35, 52.5, 15],
    ],
    [150, 130],
  ),
  check_wrist: wristPose("check_wrist", [40, 37.5, 15], 60, 25),
  /** Raised from `check_wrist` whilst an npc is near: drawn in, though no forearm before the chest fits the box */
  check_wrist_avoid: wristPose("check_wrist_avoid", [20, 15, 10], 120, 15),
  look_around: lookAround("look_around", "breathe"),
  shrug: shrug("shrug", "breathe"),
  shift_weight: shiftWeight("shift_weight"),
  sit_rub_chin: rubChin("sit_rub_chin", "sit", [[35, 52.5, 15]], [135]),
  sit_check_wrist: checkWrist("sit_check_wrist", "sit", [[30, -30, -10]], [95]),
  sit_look_around: lookAround("sit_look_around", "sit"),
  sit_shrug: shrug("sit_shrug", "sit"),
  sit_lean_forward: leanForward("sit_lean_forward"),
  lie_look_around: lookAround("lie_look_around", "lie"),
  lie_stretch: lieStretch("lie_stretch"),
};

/** Metres a fidget may reach out front past its base's box: forearms before the torso, which is thick */
const frontLeeway: Partial<Record<string, number>> = {
  check_wrist: 0.235,
  check_wrist_avoid: 0.165,
  rub_chin: 0.095,
  sit_check_wrist: 0.05,
  sit_lean_forward: 0.015,
};
/** Metres a lain fidget may reach up past its base's box: up is their front */
const upLeeway: Partial<Record<string, number>> = {};

//#endregion

//#region every recipe

const clips = {
  /** Thighs level as they were, shins hung from the knee, soles near flat and breathing a little */
  sit: recipe({
    params: {
      /** Degrees the knees bend */
      knee: 80,
    },
    tracks: ({ knee }) =>
      sides.flatMap((side) => [
        turn("sit", `${side}shin`, () => [-knee, 0, 0], [0]),
        turn("sit", `${side}foot`, (t) => [breathe(knee - 92, knee - 87)(t), 0, 0]),
      ]),
  }),

  /**
   * A reach from `sit`, whose hand rests UNDER a table: drawn back beside the hip, up by the ribs and
   * over the edge before it goes out, then home the same way, the torso going with it — see `w.e.reachFor`
   */
  sit_reach: recipe({
    params: {
      /** Frames each leg of it takes, and the reach is held */
      leg: 4,
      hold: 3,
    },
    tracks({ leg, hold }) {
      const bones = ["stomach", "chest", "rightarm", "rightforearm"];
      /** By `bones`. The torso's are turns ON `sit`'s own, which breathes; the arm's set out from that clip's */
      const poses: Record<string, Triple[]> = {
        sit: [
          [0, 0, 0],
          [0, 0, 0],
          [5.7842, 7.0689, 5.1276],
          [50, 0, 0],
        ],
        back: [
          [1.5, 0, 0],
          [1.5, -5, 0],
          [-30, 0, 10],
          [75, 0, 0],
        ],
        up: [
          [3, 0, 0],
          [3, -8, 0],
          [-55, 0, 20],
          [130, 0, 0],
        ],
        over: [
          [0, 0, 0],
          [-1, 2, 0],
          [5, 0, 0],
          [115, 0, 0],
        ],
        out: [
          [-4, 0, 0],
          [-4, 6, 0],
          [84, 0, 0],
          [15, 0, 0],
        ],
      };
      const there = ["sit", "back", "up", "over", "out"];
      const order = [...there, ...there.toReversed()];
      /** The frame each is at: the reach held between the two `out`s */
      const frame = (i: number) => i * leg + (i >= there.length ? hold - leg : 0);
      return bones.map((bone, b) => {
        const keyed = order.map((name, i): [number, Triple] => [frame(i), poses[name][b]]);
        return turn("sit_reach", bone, through(keyed), [...keyed.map(([f]) => f / fps), length]);
      });
    },
  }),

  /**
   * A squat to the floor, to put something down on it or take something off it: a still pose the game
   * eases in and out of. Feet where they stand at rest, the hips down and back, the torso over the knees
   */
  crouch: recipe({
    params: {
      /** Model units the hips come down, and go back */
      down: 8.5,
      back: 3,
      /** Degrees the torso leans forward */
      lean: 60,
      /** Degrees the right arm hangs forward of straight down, to touch the floor ahead */
      reach: 22,
    },
    tracks(p) {
      return [
        ...squatLegs("crouch", p.down, p.back),
        turn("crouch", "stomach", () => [-p.lean / 2, 0, 0], still),
        turn("crouch", "chest", () => [-p.lean / 2, 0, 0], still),
        turn("crouch", "head", () => [p.lean - 20, 0, 0], still), // looking down at it
        turn("crouch", "rightarm", () => [p.lean + p.reach, 0, 0], still),
        turn("crouch", "rightforearm", () => [0, 0, 0], still),
        turn("crouch", "leftarm", () => [p.lean - 25, 0, -4], still), // resting on the knee
        turn("crouch", "leftforearm", () => [75, 0, 0], still),
      ];
    },
  }),

  ...crouchClips,
  crouch_backwards: reversedOf("crouch_backwards", crouchClips.crouch_walk),
  crouch_strafe_left: mirroredOf("crouch_strafe_left", crouchClips.crouch_strafe_right),
  crouch_half_backwards: reversedOf("crouch_half_backwards", crouchClips.crouch_half_walk),
  crouch_half_strafe_left: mirroredOf("crouch_half_strafe_left", crouchClips.crouch_half_strafe_right),

  /**
   * A balanced stance that rocks: as first keyed it stood over its front foot, the other trailing, and
   * leant 9° to 14°. `phaser_aim_avoid` shares its root, legs, torso and head
   */
  phaser_aim: recipe({
    params: {
      /** Model units the hips rock, end to end, about where the stance stood */
      rock: 0.9,
      /** Model units the hips stand lower than first keyed, so both legs reach their feet */
      drop: 0.5,
      /** Model units they sink as they rock forward */
      sink: 0.25,
      /** Degrees the torso leans forward at the back of the rock, and how many more at the front */
      lean: 2,
      breathe: 3,
    },
    tracks(p) {
      const both = ["phaser_aim", "phaser_aim_avoid"];
      /** As first keyed */
      const keyed = {
        root: [0, -0.04, 1] as Triple,
        legs: {
          left: { thigh: [9, 0.11, -2.5], shinX: -16 },
          right: { thigh: [-14, -0.11, 2.5], shinX: -16 },
        } as Record<Side, Leg>,
      };
      // the feet keep their spacing, moved together so the hips stand midway between them
      const [left, right] = sides.map((side) => {
        const leg = keyed.legs[side];
        return ankleOf(side, leg, keyed.root, leg.thigh[0], leg.shinX);
      });
      const shift = keyed.root[2] - (left.z + right.z) / 2;
      left.z += shift;
      right.z += shift;
      const rootAt = (t: number): Triple => [
        keyed.root[0],
        keyed.root[1] - p.drop - p.sink * swell(t),
        keyed.root[2] + p.rock * (0.5 - swell(t)), // `+z` is backward
      ];

      // arms and head are the torso's children: each `x` is its pitch in the world plus (the head's,
      // minus) the lean, so the gun stays level as the torso breathes
      const lean = breathe(p.lean, p.lean + p.breathe);
      /** `[clip, bone, pitch in the world at the back and at the front, y, z]` */
      const arms: [string, string, number, number, number, number][] = [
        ["phaser_aim", "rightarm", 90, 90, 0, 0],
        ["phaser_aim", "leftarm", -10, -8, 0, -2], // free, as idle's: the aim is one-handed
        ["phaser_aim_avoid", "rightarm", 6, 3, 0, 6],
        ["phaser_aim_avoid", "leftarm", -10, -8, 0, -2],
      ];
      return [
        ...plantedLegs(both, rootAt, keyed.legs, { left, right }),
        ...both.flatMap((clip) => [
          turn(clip, "stomach", (t) => [-lean(t) / 2, 0, 0]),
          turn(clip, "chest", (t) => [-lean(t) / 2, 0, 0]),
          turn(clip, "head", (t) => [lean(t), 0, 0]),
          turn(clip, "leftforearm", (t) => [breathe(9, 4)(t), 0, 0]),
        ]),
        ...arms.map(([clip, bone, back, front, y, z]) =>
          turn(clip, bone, (t) => [breathe(back, front)(t) + lean(t), y, z]),
        ),
      ];
    },
  }),

  ...fidgetClips,
};

//#endregion

//#region which recipes, with what, and the two files written

/** `sit knee=70 phaser_aim rock=0.6`: each `name=value` is of the recipe named before it */
const chosen = new Map<string, Record<string, number>>();
let current: undefined | Record<string, number>;
for (const arg of process.argv.slice(2)) {
  const [name, value] = arg.split("=");
  if (value === undefined) {
    if (!(name in clips)) throw Error(`no recipe "${name}": there are ${Object.keys(clips).join(", ")}`);
    chosen.set(name, (current = { ...clips[name as keyof typeof clips].params }));
  } else if (current === undefined || !(name in current) || Number.isNaN(Number(value))) {
    throw Error(`"${arg}" should follow a recipe that has "${name}", and be a number`);
  } else {
    current[name] = Number(value);
  }
}
if (chosen.size === 0) for (const [name, { params }] of Object.entries(clips)) chosen.set(name, { ...params });

/** Clips made afresh, each as its base: renamed copies the tracks then re-key */
const made = [...chosen.keys()].flatMap((name) =>
  Object.entries((clips[name as keyof typeof clips] as Recipe<Record<string, number>>).bases ?? {}),
);
for (const [clip, base] of made) {
  const keyed = structuredClone(bbmodel.animations.find((a: { name: string }) => a.name === base));
  Object.assign(keyed, { uuid: randomUUID(), name: clip });
  for (const animator of Object.values<any>(keyed.animators))
    for (const key of animator.keyframes ?? []) key.uuid = randomUUID();
  bbmodel.animations = bbmodel.animations.filter((a: { name: string }) => a.name !== clip).concat(keyed);
  const baked = structuredClone(gltf.animations.find((a: { name: string }) => a.name === base));
  gltf.animations = gltf.animations.filter((a: { name: string }) => a.name !== clip).concat({ ...baked, name: clip });
}

const tracks = [...chosen].flatMap(([name, params]) => {
  const made = (clips[name as keyof typeof clips] as Recipe<Record<string, number>>).tracks(params);
  console.log(`${name}: ${made.length} tracks`, params);
  return made;
});

// current.bbmodel: the keyframes, as strings, each channel's replaced whole
for (const { clip, bone, channel, keys, at } of tracks) {
  const animation = bbmodel.animations.find((a: { name: string }) => a.name === clip);
  const animator = Object.values<any>(animation.animators).find((a) => a.name === bone);
  if (animator === undefined) throw Error(`${clip}: no animator for ${bone}`);
  animator.keyframes = (animator.keyframes ?? []) // none, and Blockbench saves no list
    .filter((k: { channel: string }) => k.channel !== channel)
    .concat(
      keys.map((time) => {
        const [x, y, z] = at(time).map((v) => String(+v.toFixed(4)));
        return {
          channel,
          data_points: [{ x, y, z }],
          uuid: randomUUID(),
          time: +time.toFixed(5), // as Blockbench saves them
          color: -1,
          interpolation: "catmullrom",
        };
      }),
    );
}

// current.gltf: baked a key a frame, as its exporter does — or one alone where nothing moves
const chunks: Buffer[] = [Buffer.from(gltf.buffers[0].uri.split(",")[1], "base64")];
let byteLength = chunks[0].length;
function addAccessor(rows: number[][], type: "SCALAR" | "VEC3" | "VEC4") {
  const data = Buffer.from(new Float32Array(rows.flat()).buffer);
  gltf.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: data.length });
  chunks.push(data);
  byteLength += data.length;
  const bounds = type === "SCALAR" ? { min: [Math.min(...rows.flat())], max: [Math.max(...rows.flat())] } : {};
  return (
    gltf.accessors.push({
      bufferView: gltf.bufferViews.length - 1,
      componentType: 5126,
      count: rows.length,
      type,
      ...bounds,
    }) - 1
  );
}
/** A key a frame, by clip length, or one alone */
const times = new Map<number, number>();
const timesOf = (secs: number) => {
  if (!times.has(secs))
    times.set(
      secs,
      addAccessor(
        framesOf(secs).map((t) => [t]),
        "SCALAR",
      ),
    );
  return times.get(secs) as number;
};
const oneTime = addAccessor([[0]], "SCALAR");

for (const { clip, bone, channel, at } of tracks) {
  let animation = gltf.animations.find((a: { name: string }) => a.name === clip);
  if (animation === undefined) gltf.animations.push((animation = { name: clip, channels: [], samplers: [] })); // new to it
  const node = gltf.nodes.findIndex((n: { name: string }) => n.name === bone);
  const path = channel === "rotation" ? "rotation" : "translation";
  const rows = framesOf(secsOf(clip)).map((t) =>
    channel === "rotation"
      ? new THREE.Quaternion().setFromEuler(euler(at(t))).toArray()
      : rest(bone)
          .add(new THREE.Vector3(...at(t)))
          .divideScalar(16)
          .toArray(),
  );
  const still = rows.every((row) => row.every((v, i) => Math.abs(v - rows[0][i]) < 1e-7));
  const sampler = {
    input: still ? oneTime : timesOf(secsOf(clip)),
    output: addAccessor(still ? [rows[0]] : rows, channel === "rotation" ? "VEC4" : "VEC3"),
    interpolation: "LINEAR",
  };
  const found = animation.channels.find((c: any) => c.target.node === node && c.target.path === path);
  if (found !== undefined) animation.samplers[found.sampler] = sampler;
  else animation.channels.push({ sampler: animation.samplers.push(sampler) - 1, target: { node, path } });
}
const written = Buffer.concat(chunks);
gltf.buffers[0] = { byteLength, uri: `data:application/octet-stream;base64,${written.toString("base64")}` };

// a clip made afresh takes no more room than its base, so shows no more through a wall. Its head may turn, as a look does
const xyz = (v: THREE.Vector3) => v.toArray().map((n) => n.toFixed(3));
const box = (b: THREE.Box3) => `${xyz(b.min)} to ${xyz(b.max)}`;
const outside = made.filter(([clip, base]) => {
  const [own, room] = [boxOf(clip, written, "head"), boxOf(base, written).expandByScalar(0.005)];
  room.min.z -= frontLeeway[clip] ?? 0; // -z is ahead
  room.max.y += upLeeway[clip] ?? 0;
  const fits = room.containsBox(own);
  console.log(`${clip}: ${box(own)}, ${fits ? "within" : "OUTSIDE"} ${base}'s ${box(room)}`);
  return !fits;
});
if (outside.length > 0) throw Error(`outside their base's box: ${outside.map(([clip]) => clip)}. Nothing written`);

compactGltf(written);
writeFileSync(join(dir, "current.bbmodel"), JSON.stringify(bbmodel));
writeFileSync(join(dir, "current.gltf"), JSON.stringify(gltf));

/** Keeps only the accessors still in use, so a re-run or a replaced clip leaves nothing behind */
function compactGltf(buffer: Buffer) {
  const inUse = new Set<number>();
  for (const mesh of gltf.meshes)
    for (const p of mesh.primitives) {
      for (const a of Object.values<number>(p.attributes)) inUse.add(a);
      if (p.indices !== undefined) inUse.add(p.indices);
    }
  for (const skin of gltf.skins) inUse.add(skin.inverseBindMatrices);
  for (const a of gltf.animations)
    for (const s of a.samplers) {
      inUse.add(s.input);
      inUse.add(s.output);
    }
  const kept = [...inUse].sort((a, b) => a - b);
  const [parts, views, viewOf] = [[] as Buffer[], [] as any[], new Map<number, number>()];
  let offset = 0;
  const accessors = kept.map((i) => {
    const accessor = gltf.accessors[i];
    if (!viewOf.has(accessor.bufferView)) {
      const view = gltf.bufferViews[accessor.bufferView];
      const pad = (4 - (offset % 4)) % 4;
      parts.push(Buffer.alloc(pad), buffer.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
      offset += pad;
      viewOf.set(accessor.bufferView, views.push({ ...view, byteOffset: offset }) - 1);
      offset += view.byteLength;
    }
    return { ...accessor, bufferView: viewOf.get(accessor.bufferView) };
  });
  const renumber = new Map(kept.map((a, i) => [a, i]));
  const to = (a: number) => renumber.get(a) as number;
  for (const mesh of gltf.meshes)
    for (const p of mesh.primitives) {
      for (const key of Object.keys(p.attributes)) p.attributes[key] = to(p.attributes[key]);
      if (p.indices !== undefined) p.indices = to(p.indices);
    }
  for (const skin of gltf.skins) skin.inverseBindMatrices = to(skin.inverseBindMatrices);
  for (const a of gltf.animations)
    for (const s of a.samplers) Object.assign(s, { input: to(s.input), output: to(s.output) });
  const all = Buffer.concat(parts);
  Object.assign(gltf, { accessors, bufferViews: views });
  gltf.buffers[0] = { byteLength: all.length, uri: `data:application/octet-stream;base64,${all.toString("base64")}` };
}

//#endregion
