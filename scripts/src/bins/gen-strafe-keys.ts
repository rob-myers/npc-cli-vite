#!/usr/bin/env node

/**
 * Solves a strafe's legs from a foot plan, so a planted foot never slides — see `docs/npc-strafe.md`.
 * Prints the keyframes as JSON, or with `--blockbench` a snippet for Blockbench's console that keys them
 * into the open project's `--name` clip and regenerates its `right` mirror
 * ```sh
 * gen-strafe-keys
 * gen-strafe-keys --stride 0.6 --harmonics 2 --blockbench | pbcopy
 * gen-strafe-keys --name run_strafe_left --length 0.752 --swing 0.7917 --duty 0.2917 --upper run --blockbench
 * gen-strafe-keys --axis back --name run_backwards --length 0.752 --stride 1.25 --duty 0.45 --blockbench
 * ```
 */

import { readFileSync } from "node:fs";
import { join } from "node:path/posix";
import { parseArgs } from "node:util";
import * as THREE from "three";
import { PROJECT_ROOT } from "../const.ts";

const { values: opts } = parseArgs({
  options: {
    /** Model units a cycle moves them — `gaitStride` is this times `npcScale` */
    stride: { type: "string", default: "0.6" },
    /** Share of a cycle each foot is planted */
    duty: { type: "string", default: "0.6" },
    /** Model units the swinging foot lifts */
    lift: { type: "string", default: "0.13" },
    /** Share of the planted feet's speed the swinging foot leaves and lands at. Under `1`, a long swing stays in reach */
    tangent: { type: "string", default: "1" },
    /** Planted legs reach this share of their length, so knees stay slightly bent */
    soft: { type: "string", default: "0.99" },
    /** Fourier harmonics kept in the hips' bob: fewer is smoother */
    harmonics: { type: "string", default: "2" },
    /** Model units the ankles never come closer than, else the feet clip */
    gap: { type: "string", default: "0.234" },
    /** The clip keyed, moving to their left. Its mirror swaps `left` for `right` in the name */
    name: { type: "string", default: "strafe_left" },
    /** Seconds a cycle lasts */
    length: { type: "string", default: "1" },
    /** Share of a cycle at which the right foot lifts. The left's is half a cycle on */
    swing: { type: "string", default: "0.05" },
    /** A clip whose torso and arms the keyed clip takes, as long as it, e.g. `run`. Else they are kept */
    upper: { type: "string" },
    /** `side` strafes to their left. `back` backs up, each foot in line with its hip, and keys no mirror */
    axis: { type: "string", default: "side" },
    blockbench: { type: "boolean", default: false },
  },
});
const [stride, duty, lift, soft, gap] = [opts.stride, opts.duty, opts.lift, opts.soft, opts.gap].map(Number);
const [length, swing, tangent] = [opts.length, opts.swing, opts.tangent].map(Number);
const harmonics = Number(opts.harmonics);
const back = opts.axis === "back";
const samples = 24;

// the rig's legs, from the exported model
const gltf = JSON.parse(readFileSync(join(PROJECT_ROOT, "packages/media/src/blockbench/current/current.gltf"), "utf8"));
const translation = (name: string) =>
  new THREE.Vector3().fromArray(gltf.nodes.find((n: { name: string }) => n.name === name).translation);
const sides = ["left", "right"] as const;
type Side = (typeof sides)[number];
const hip = { left: translation("leftthigh"), right: translation("rightthigh") };
const kneeT = translation("leftshin");
const footT = translation("leftfoot");
const rest = kneeT.clone().add(footT); // ankle from hip at rest
const legLength = rest.length();

// moving to their left (-x): planted feet travel +x relative to the body. Swings as the forward gait's
const swingStart = { right: swing, left: (swing + 0.5) % 1 };
const spread = (gap + 0.5 * stride - (hip.right.x - hip.left.x)) / 2;
const centre = back ? { left: 0, right: 0 } : { left: hip.left.x - spread, right: hip.right.x + spread };
/** The ankle from `side`'s hip, with the foot at `along` on the axis. Backing up, planted feet travel forwards (-z) */
const ankleFrom = (side: Side, along: number) =>
  back ? { x: rest.x, z: rest.z - along } : { x: along - hip[side].x, z: rest.z };

/** The foot's place on the axis (body frame) and lift of `side` at phase `t` */
function footAt(side: Side, t: number) {
  const sinceLand = (t - ((swingStart[side] + 1 - duty) % 1) + 1) % 1;
  const [from, to] = [centre[side] + 0.5 * duty * stride, centre[side] - 0.5 * duty * stride];
  if (sinceLand < duty) return { x: to + stride * sinceLand, y: 0, planted: true };
  // Hermite, leaving and landing at the planted feet's speed; lifted by sin², so no jolt either
  const u = (sinceLand - duty) / (1 - duty);
  const v = tangent * (1 - duty) * stride;
  const x =
    (2 * u ** 3 - 3 * u ** 2 + 1) * from +
    (u ** 3 - 2 * u ** 2 + u) * v +
    (3 * u ** 2 - 2 * u ** 3) * to +
    (u ** 3 - u ** 2) * v;
  return { x, y: lift * Math.sin(Math.PI * u) ** 2, planted: false };
}

// hips: a smooth curve fitted just under what the planted legs reach
const grid = Array.from({ length: 480 }, (_, i) => i / 480);
/** In flight, with neither foot planted, the hips may rise as high as a leg hanging straight */
const flightReach = Math.sqrt((soft * legLength) ** 2 - rest.x ** 2 - rest.z ** 2);
const reachAt = (t: number) =>
  Math.min(
    flightReach,
    ...sides.flatMap((side) => {
      const foot = footAt(side, t);
      const { x, z } = ankleFrom(side, foot.x);
      const reach = Math.sqrt(Math.max(0, (soft * legLength) ** 2 - x ** 2 - z ** 2));
      // backing up, a swinging foot far ahead or behind holds them down too
      return foot.planted ? [reach] : back ? [foot.y + reach] : [];
    }),
  );
const reaches = grid.map(reachAt);
const coef = Array.from({ length: harmonics + 1 }, (_, k) =>
  [Math.cos, Math.sin].map(
    (f) => ((k === 0 ? 1 : 2) / grid.length) * reaches.reduce((sum, r, i) => sum + r * f(2 * Math.PI * k * grid[i]), 0),
  ),
);
const fit = (t: number) =>
  coef.reduce((sum, [a, b], k) => sum + a * Math.cos(2 * Math.PI * k * t) + b * Math.sin(2 * Math.PI * k * t), 0);
const drop = Math.max(...grid.map((t, i) => fit(t) - reaches[i]));
const hipHeightAt = (t: number) => fit(t) - drop;

// a leg is (hip z, hip x, knee x) in radians, as Blockbench keys them: Euler "ZYX"
type Leg = [number, number, number];
const toQuat = (x: number, z: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, 0, z, "ZYX"));
const ankleOf = ([z, a, k]: Leg) => {
  const q = toQuat(a, z);
  return kneeT
    .clone()
    .applyQuaternion(q)
    .add(footT.clone().applyQuaternion(q.multiply(toQuat(k, 0))));
};
/** Newton's method from `guess`, with a numerical Jacobian */
function solveLeg(target: THREE.Vector3, guess: Leg): Leg {
  let leg = guess;
  for (let i = 0; i < 60; i++) {
    const miss = ankleOf(leg).sub(target);
    if (miss.length() < 1e-7) break;
    const [dz, da, dk] = [0, 1, 2].map((j) => {
      const nudged = [...leg] as Leg;
      nudged[j] += 1e-5;
      return ankleOf(nudged).sub(target).sub(miss).divideScalar(1e-5);
    });
    const jacobian = new THREE.Matrix3().set(dz.x, da.x, dk.x, dz.y, da.y, dk.y, dz.z, da.z, dk.z);
    const step = miss.applyMatrix3(jacobian.invert());
    leg = [leg[0] - step.x, leg[1] - step.y, leg[2] - step.z];
  }
  return leg;
}

const wrap = (r: number) => Math.atan2(Math.sin(r), Math.cos(r));
/** As `solveLeg`, but the knee bent as a knee bends (negative), each angle within a half turn. Fresh guesses if need be */
function solveKnee(target: THREE.Vector3, guess: Leg): Leg {
  const tries: Leg[] = [guess, [guess[0], guess[1], -Math.abs(guess[2]) || -0.4], [0, 0.2, -0.4], [0, 0.8, -1.5]];
  for (const from of tries) {
    const leg = solveLeg(target, from).map(wrap) as Leg;
    if (leg[2] <= 1e-6 && ankleOf(leg).distanceTo(target) < 1e-5) return leg;
  }
  return solveLeg(target, guess).map(wrap) as Leg; // its miss is reported
}

const deg = (r: number) => +THREE.MathUtils.radToDeg(r).toFixed(3);
const keys: Record<string, [number, number, number][]> = { "skeleton-root": [] };
const guess: Record<Side, Leg> = { left: [0, 0.2, -0.4], right: [0, 0.2, -0.4] };
let [worstMiss, widest] = [0, 0];

for (let i = 0; i <= samples; i++) {
  const t = (i / samples) % 1;
  const hipHeight = hipHeightAt(t);
  for (const side of sides) {
    const foot = footAt(side, t);
    const { x, z: ankleZ } = ankleFrom(side, foot.x);
    const target = new THREE.Vector3(x, foot.y - hipHeight, ankleZ);
    const [z, a, k] = (guess[side] = solveKnee(target, guess[side]));
    worstMiss = Math.max(worstMiss, ankleOf([z, a, k]).distanceTo(target));
    widest = Math.max(widest, Math.abs(deg(z)));
    // the sole kept flat: undo the leg and knee
    const flat = new THREE.Euler().setFromQuaternion(toQuat(a, z).multiply(toQuat(k, 0)).invert(), "ZYX");
    (keys[`${side}thigh`] ??= []).push([deg(a), 0, deg(z)]);
    (keys[`${side}shin`] ??= []).push([deg(k), 0, 0]);
    (keys[`${side}foot`] ??= []).push([deg(flat.x), deg(flat.y), deg(flat.z)]);
  }
  keys["skeleton-root"].push([0, +((hipHeight + rest.y) * 16).toFixed(3), 0]); // Blockbench pixels
}

console.error(
  `worst miss ${worstMiss.toExponential(1)}, hips splay ${widest}°, hips drop ${drop.toFixed(4)} — ` +
    `gaitStride ≈ ${(stride * 0.8).toFixed(2)} m, if npcScale is 0.8`,
);
console.log(opts.blockbench ? blockbenchSnippet(keys) : JSON.stringify(keys));

/** Keys `--name` and regenerates its `right` mirror, half a cycle on, unless `back` — outside the undo stack */
function blockbenchSnippet(data: typeof keys) {
  const [leftName, rightName] = [opts.name, opts.name.replace("left", "right")];
  return `(() => {
  const data = ${JSON.stringify(data)};
  const [length, upperName] = [${length}, ${JSON.stringify(opts.upper ?? null)}];
  const group = (name) => Group.all.find((g) => g.name === name);
  const replace = (name) => {
    Animation.all.filter((a) => a.name === name).forEach((a) => a.remove(false, false));
    return new Animation({ name, length, loop: "loop", snapping: +(24 / length).toFixed(2) }).add(false);
  };
  const left = Animation.all.find((a) => a.name === "${leftName}") ?? replace("${leftName}");
  left.length = length;
  for (const [bone, rows] of Object.entries(data)) {
    const channel = bone === "skeleton-root" ? "position" : "rotation";
    const animator = left.getBoneAnimator(group(bone));
    animator.keyframes.filter((k) => k.channel === channel).forEach((k) => k.remove());
    rows.forEach(([x, y, z], i) => animator.addKeyframe({ channel, time: (i / 24) * length, interpolation: "catmullrom", data_points: [{ x, y, z }] }));
  }
  const upper = upperName === null ? null : Animation.all.find((a) => a.name === upperName);
  for (const a of Object.values(upper?.animators ?? {})) {
    if (!["hips", "stomach", "chest", "head", "leftarm", "leftforearm", "rightarm", "rightforearm"].includes(a.name)) continue;
    const animator = left.getBoneAnimator(group(a.name));
    animator.keyframes.slice().forEach((k) => k.remove());
    for (const k of a.keyframes) {
      const point = Object.fromEntries(["x", "y", "z"].map((c) => [c, +k.data_points[0][c]]));
      animator.addKeyframe({ channel: k.channel, time: k.time, interpolation: k.interpolation, data_points: [point] });
    }
  }
  if (${back}) return "keyed ${leftName}";
  const right = replace("${rightName}");
  const swap = (n) => (n.startsWith("left") ? "right" + n.slice(4) : n.startsWith("right") ? "left" + n.slice(5) : n);
  for (const a of Object.values(left.animators)) {
    const animator = right.getBoneAnimator(group(swap(a.name)));
    for (const k of a.keyframes) {
      if (k.time >= length - 1e-6) continue;
      const [x, y, z] = ["x", "y", "z"].map((c) => +k.data_points[0][c]);
      const point = k.channel === "rotation" ? { x, y: -y, z: -z } : { x: -x, y, z };
      const time = +((k.time + length / 2) % length).toFixed(6);
      animator.addKeyframe({ channel: k.channel, time, interpolation: k.interpolation, data_points: [point] });
      if (time === 0) animator.addKeyframe({ channel: k.channel, time: length, interpolation: k.interpolation, data_points: [point] });
    }
  }
  return "keyed ${leftName}, mirrored ${rightName}";
})()`;
}
