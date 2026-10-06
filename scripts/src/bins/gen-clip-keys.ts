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

/** Every clip is this long, at this many frames a second */
const length = 2.5;
const fps = 24;
const frames = Array.from({ length: length * fps + 1 }, (_, i) => i / fps);
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

//#endregion

//#region the recipes

const recipe = <P extends Record<string, number>>(r: Recipe<P>) => r;

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
      const still = [0];
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
      return [
        ...plantedLegs(["crouch"], () => [0, -p.down, p.back], bent, { left, right }, still),
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
  animator.keyframes = animator.keyframes
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
const times = {
  all: addAccessor(
    frames.map((t) => [t]),
    "SCALAR",
  ),
  one: addAccessor([[0]], "SCALAR"),
};

for (const { clip, bone, channel, at } of tracks) {
  let animation = gltf.animations.find((a: { name: string }) => a.name === clip);
  if (animation === undefined) gltf.animations.push((animation = { name: clip, channels: [], samplers: [] })); // new to it
  const node = gltf.nodes.findIndex((n: { name: string }) => n.name === bone);
  const path = channel === "rotation" ? "rotation" : "translation";
  const rows = frames.map((t) =>
    channel === "rotation"
      ? new THREE.Quaternion().setFromEuler(euler(at(t))).toArray()
      : rest(bone)
          .add(new THREE.Vector3(...at(t)))
          .divideScalar(16)
          .toArray(),
  );
  const still = rows.every((row) => row.every((v, i) => Math.abs(v - rows[0][i]) < 1e-7));
  const sampler = {
    input: still ? times.one : times.all,
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
