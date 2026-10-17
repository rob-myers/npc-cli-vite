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
 * It appends to the glTF's buffer, so restore both files first: `git checkout` them, or export from Blockbench
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
/** What re-keys a clip, or a few that share a pose: `params` are its defaults, each settable as `name=value` */
type Recipe<P extends Record<string, number>> = { params: P; tracks(params: P): Track[] };

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
 * The legs of `clip` stepping: the root where `rootAt` says, and each ankle on its path `feet`. Each thigh's swing and
 * turn out, and its knee, are solved to reach it, and its foot keeps the sole flat. Throws where a leg cannot reach
 */
function steppingLegs(
  clip: string,
  rootAt: (t: number) => Triple,
  feet: Record<Side, (t: number) => THREE.Vector3>,
  keys = gaitFrames,
): Track[] {
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
      const thigh = new THREE.Quaternion().setFromEuler(euler([x, y, 0]));
      const knee = thigh.clone().multiply(new THREE.Quaternion().setFromEuler(euler([shin, 0, 0])));
      return new THREE.Vector3(...root)
        .add(rest(`${side}thigh`))
        .add(rest(`${side}shin`).applyQuaternion(thigh))
        .add(rest(`${side}foot`).applyQuaternion(knee));
    };
    // Newton on the ankle's three coordinates: thigh `x`, its `y` turning the knee out, and the knee
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
      throw Error(`${clip}: the ${side} leg cannot reach its foot at ${t}s`);
    }
    // the foot undoes the leg's turn, so the sole is as at rest: flat, and ahead
    const leg = new THREE.Quaternion()
      .setFromEuler(euler([v[0], v[1], 0]))
      .multiply(new THREE.Quaternion().setFromEuler(euler([v[2], 0, 0])));
    const foot = new THREE.Euler().setFromQuaternion(leg.invert(), "ZYX");
    const { radToDeg } = THREE.MathUtils;
    const result: [Triple, Triple, Triple] = [
      [v[0], v[1], 0],
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
function crouchedUpper(clip: string, lean: number) {
  return [
    turn(clip, "stomach", () => [-lean / 2, 0, 0], still),
    turn(clip, "chest", () => [-lean / 2, 0, 0], still),
    turn(clip, "head", () => [lean, 0, 0], still),
    turn(clip, "rightforearm", () => [40, 0, -10], still),
    turn(clip, "leftforearm", () => [40, 0, 10], still),
  ];
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
 * A still squat behind cover, to rise from: `crouch`'s legs, the torso leant `lean`, the head level, the arms posed.
 * Armed, `phaser_aim` and `phaser_aim_avoid` play over its arms
 */
const crouchStill = (
  clip: string,
  params: Record<"down" | "back" | "lean" | "armX" | "armZ" | "foreX" | "foreZ", number>,
) =>
  recipe({
    params,
    tracks: (p) => [
      ...squatLegs(clip, p.down, p.back),
      turn(clip, "stomach", () => [-p.lean / 2, 0, 0], still),
      turn(clip, "chest", () => [-p.lean / 2, 0, 0], still),
      turn(clip, "head", () => [p.lean, 0, 0], still),
      turn(clip, "rightarm", () => [p.armX, 0, p.armZ], still),
      turn(clip, "rightforearm", () => [p.foreX, 0, p.foreZ], still),
      turn(clip, "leftarm", () => [p.armX, 0, -p.armZ], still),
      turn(clip, "leftforearm", () => [p.foreX, 0, -p.foreZ], still),
    ],
  });

/** A crouch walking ahead: flat-footed steps, the hips swaying over the planted foot, the arms hanging forward */
const crouchWalk = (
  clip: string,
  params: Record<"down" | "back" | "lean" | "stride" | "duty" | "lift" | "sway" | "bob" | "swing", number>,
) =>
  recipe({
    params,
    tracks(p) {
      const feet = restAnkles();
      const ahead = new THREE.Vector3(0, 0, -1); // a foot plants ahead, and slides back
      /** The left foot lands at the start, the right half a cycle on */
      const swayAt = (t: number) => -p.sway * Math.cos(2 * Math.PI * (t / gaitLength - p.duty / 2));
      const armSwing = (t: number) => p.swing * Math.cos(2 * Math.PI * (t / gaitLength));
      return [
        ...steppingLegs(clip, (t) => [swayAt(t), -p.down + p.bob * Math.cos(4 * Math.PI * (t / gaitLength)), p.back], {
          left: stepping(feet.left, ahead, p, 0),
          right: stepping(feet.right, ahead, p, 0.5),
        }),
        ...crouchedUpper(clip, p.lean),
        // the arm opposite the leading foot comes forward
        turn(clip, "rightarm", (t) => [p.lean + 20 + armSwing(t), 0, 6], gaitFrames),
        turn(clip, "leftarm", (t) => [p.lean + 20 - armSwing(t), 0, -6], gaitFrames),
      ];
    },
  });

/** A crouch stepping to their right: the right foot leads, the left closes up behind it */
const crouchStrafeRight = (
  clip: string,
  params: Record<"down" | "back" | "lean" | "stride" | "duty" | "lift" | "bob" | "wide", number>,
) =>
  recipe({
    params,
    tracks(p) {
      const feet = restAnkles();
      feet.left.x -= p.wide; // so the two never meet
      feet.right.x += p.wide;
      const toRight = new THREE.Vector3(1, 0, 0); // their right is `+x`
      const left = stepping(feet.left, toRight, p, 0.5);
      const rightFoot = stepping(feet.right, toRight, p, 0);
      // a foot is about 2 wide
      const gap = Math.min(...gaitFrames.map((t) => rightFoot(t).x - left(t).x));
      if (gap < 2.2) throw Error(`${clip}: the ankles come within ${gap.toFixed(2)} of each other`);
      return [
        ...steppingLegs(clip, (t) => [0, -p.down + p.bob * Math.cos(4 * Math.PI * (t / gaitLength)), p.back], {
          left,
          right: rightFoot,
        }),
        ...crouchedUpper(clip, p.lean),
        turn(clip, "rightarm", () => [p.lean + 20, 0, 8], [0]),
        turn(clip, "leftarm", () => [p.lean + 20, 0, -8], [0]),
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

/** The full crouch's, and the half crouch's: less low, so a longer stride. Arms searched: elbows on knees, hands on thighs */
const crouchClips = {
  crouch_cover: crouchStill("crouch_cover", {
    down: 8.5,
    back: 3,
    lean: 35,
    armX: 35,
    armZ: -10,
    foreX: 70,
    foreZ: -30,
  }),
  crouch_walk: crouchWalk("crouch_walk", {
    down: 8.5,
    back: 3,
    lean: 35,
    stride: 8,
    duty: 0.6,
    lift: 1.5,
    sway: 0.4,
    bob: 0.3,
    swing: 8,
  }),
  crouch_strafe_right: crouchStrafeRight("crouch_strafe_right", {
    down: 8.5,
    back: 3,
    lean: 35,
    stride: 5,
    duty: 0.6,
    lift: 1.2,
    bob: 0.3,
    wide: 0.75,
  }),
  crouch_half: crouchStill("crouch_half", { down: 4, back: 1.5, lean: 28, armX: -5, armZ: -2, foreX: 70, foreZ: -30 }),
  crouch_half_walk: crouchWalk("crouch_half_walk", {
    down: 4,
    back: 1.5,
    lean: 28,
    stride: 10,
    duty: 0.6,
    lift: 2,
    sway: 0.4,
    bob: 0.3,
    swing: 10,
  }),
  crouch_half_strafe_right: crouchStrafeRight("crouch_half_strafe_right", {
    down: 4,
    back: 1.5,
    lean: 28,
    stride: 6,
    duty: 0.6,
    lift: 1.5,
    bob: 0.3,
    wide: 0.75,
  }),
};

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
/** Each clip's length, as the bbmodel has it */
const lengthOf = (clip: string): number => bbmodel.animations.find((a: { name: string }) => a.name === clip).length;
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
  const rows = framesOf(lengthOf(clip)).map((t) =>
    channel === "rotation"
      ? new THREE.Quaternion().setFromEuler(euler(at(t))).toArray()
      : rest(bone)
          .add(new THREE.Vector3(...at(t)))
          .divideScalar(16)
          .toArray(),
  );
  const still = rows.every((row) => row.every((v, i) => Math.abs(v - rows[0][i]) < 1e-7));
  const sampler = {
    input: still ? oneTime : timesOf(lengthOf(clip)),
    output: addAccessor(still ? [rows[0]] : rows, channel === "rotation" ? "VEC4" : "VEC3"),
    interpolation: "LINEAR",
  };
  const found = animation.channels.find((c: any) => c.target.node === node && c.target.path === path);
  if (found !== undefined) animation.samplers[found.sampler] = sampler;
  else animation.channels.push({ sampler: animation.samplers.push(sampler) - 1, target: { node, path } });
}
gltf.buffers[0] = {
  byteLength,
  uri: `data:application/octet-stream;base64,${Buffer.concat(chunks).toString("base64")}`,
};

writeFileSync(join(dir, "current.bbmodel"), JSON.stringify(bbmodel));
writeFileSync(join(dir, "current.gltf"), JSON.stringify(gltf));

//#endregion
