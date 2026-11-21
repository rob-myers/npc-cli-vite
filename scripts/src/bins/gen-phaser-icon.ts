#!/usr/bin/env node

/**
 * Projects the phaser's boxes (`service/phaser-gun.ts`) into the hud's icons, `components/phaser-icon.gen.ts`:
 * one bare, and one per attachment, fitted alike. `--png` also draws each off, armed and dead, to that file.
 * ```sh
 * gen-phaser-icon
 * gen-phaser-icon --png /tmp/phaser-icon.png
 * ```
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path/posix";
import { parseArgs } from "node:util";
import { Canvas, Path2D } from "skia-canvas";
import {
  attachmentBoxes,
  type GunAttachment,
  type GunBox,
  type GunFace,
  gunAttachments,
  gunBoxes,
  gunFaces,
  muzzleOf,
} from "../../../packages/ui/world/src/service/phaser-gun.ts";
import { PROJECT_ROOT } from "../const.ts";

const { values: opts } = parseArgs({ options: { png: { type: "string" } } });

/** Degrees the view turns from side-on towards the muzzle, and looks down */
const [azimuth, elevation] = [(38 * Math.PI) / 180, (28 * Math.PI) / 180];
const [ca, sa, ce, se] = [Math.cos(azimuth), Math.sin(azimuth), Math.cos(elevation), Math.sin(elevation)];
/** The icon's size, the room kept round the gun, and how far right it sits to leave the beam room */
const [size, margin, shift] = [64, 6, -6];

/** The forearm's frame as forward, side and up */
const fsu = ([x, y, z]: number[]) => [-y, z, x] as const;
/** Screen `x` right and `y` down, and depth towards the eye */
const project = (p: number[]) => {
  const [f, s, u] = fsu(p);
  return { x: f * ca - s * sa, y: f * sa * se + s * ca * se - u * ce, depth: f * sa * ce + s * ca * ce + u * se };
};

/** Towards the eye, in the forearm's frame: faces turned this way are seen */
const eye = [se, -sa * ce, ca * ce];
const facing = (n: number[]) => n[0] * eye[0] + n[1] * eye[1] + n[2] * eye[2] > 1e-6;
const inside = (p: number[], b: GunBox) => p.every((v, i) => v > b.min[i] + 1e-6 && v < b.max[i] - 1e-6);

type IconKey = "none" | GunAttachment;
const iconKeys: IconKey[] = ["none", ...gunAttachments];
/** An attachment drawn larger than on the gun, about its back on the barrel, so it reads at hud size */
const [attachScale, attachAt] = [1.3, [0.12, -0.43, 0]];
const enlarge = (p: number[]) => p.map((v, i) => attachAt[i] + (v - attachAt[i]) * attachScale) as GunBox["min"];
const enlarged = Object.fromEntries(
  gunAttachments.map((key) => [
    key,
    attachmentBoxes[key].map((box) => ({ ...box, min: enlarge(box.min), max: enlarge(box.max) })),
  ]),
) as Record<GunAttachment, GunBox[]>;
/** The gun, bar what an attachment covers, and the attachment */
const boxesOf = (key: IconKey) =>
  key === "none" ? gunBoxes : [...gunBoxes.filter((box) => box.under !== true), ...enlarged[key]];

/** Each box's faces turned to the eye, bar those buried in another box: farthest box first, holes last, with its edges to draw */
const facesOf = (boxes: GunBox[]) =>
  [...boxes]
    .sort((a, b) => holeLast(a) - holeLast(b) || project(centre(a)).depth - project(centre(b)).depth)
    .flatMap((box) => {
      const all = gunFaces(box);
      return all
        .filter((f) => facing(f.normal) && boxes.some((o) => o !== box && inside(mean(f.points), o)) === false)
        .map((f) => ({
          box,
          normal: f.normal,
          points: f.points.map(project),
          edges: edgesOf(f, all).map((e) => e.map(project)),
        }));
    });

/** An attachment's holes come last: they sit proud of a face that, by its middle, may be nearer */
const holeLast = (box: GunBox) => (box.kind === "emitter" && box.round !== undefined ? 1 : 0);

/** A face's edges to draw: its own, and its seams where the face beyond is turned away, i.e. its silhouette */
function edgesOf({ points, edges }: GunFace, all: GunFace[]) {
  const same = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  return edges.flatMap((edge, i) => {
    const [a, b] = [points[i], points[(i + 1) % points.length]];
    if (edge === true) return [[a, b]];
    if (edge === false) return [];
    const beyond = all.find((f) => f.points.some((p, j) => same(p, b) && same(f.points[(j + 1) % f.points.length], a)));
    return beyond === undefined || facing(beyond.normal) === false ? [[a, b]] : [];
  });
}

const facesByKey = Object.fromEntries(iconKeys.map((key) => [key, facesOf(boxesOf(key))])) as Record<
  IconKey,
  ReturnType<typeof facesOf>
>;

// fitted to the icon alike, so the gun keeps its size whatever is fitted, a little left of centre
const all = Object.values(facesByKey).flatMap((faces) => faces.flatMap((f) => f.points));
const [minX, maxX] = [Math.min(...all.map((p) => p.x)), Math.max(...all.map((p) => p.x))];
const [minY, maxY] = [Math.min(...all.map((p) => p.y)), Math.max(...all.map((p) => p.y))];
const scale = (size - 2 * margin) / Math.max(maxX - minX, maxY - minY);
const toIcon = ({ x, y }: { x: number; y: number }) => ({
  x: round((x - (minX + maxX) / 2) * scale + size / 2 + shift),
  y: round((y - (minY + maxY) / 2) * scale + size / 2),
});

/** The beam along the barrel to the icon's right edge */
const beamDir = { x: ca, y: sa * se };

/** `attachment` and `attachEdge`: its shapes, white, and their black edges. `hole`: its emitters, put away */
const colors = {
  gun: "#6c7582",
  attachment: "#e4e7eb",
  attachEdge: "#0b0d10",
  hole: "#16191d",
  edge: "#2b3038",
  beam: "#ff8a5c",
  dead: "#3d7fd9",
  slot: "#2e353f",
};
/** Lit from above, as the gun is: brightest on top, darkest at the ends. And an emitter's glow */
const faceShade = (n: number[]) => 1 + 0.32 * n[0] - 0.26 * Math.abs(n[1]);
const glowShade = (n: number[]) => 1 + 0.15 * n[0] - 0.15 * Math.abs(n[1]);

/** A face's fill put away, drawn and deactivated. An attachment is white, untoned, its emitters holes */
const fillsOf = ({ kind, tone }: GunBox, n: number[], attached: boolean) => {
  const body = attached ? shade(colors.attachment, faceShade(n)) : shade(colors.gun, tone * faceShade(n));
  if (kind === "emitter") {
    const off = attached ? shade(colors.hole, faceShade(n)) : body;
    return { off, armed: shade(colors.beam, glowShade(n)), dead: shade(colors.dead, glowShade(n)) };
  }
  if (kind === "strip") {
    const slot = shade(colors.slot, faceShade(n));
    return { off: slot, armed: mix(slot, colors.beam, 0.55), dead: slot };
  }
  return { off: body, armed: body, dead: body };
};

/** One `fill` where put away, drawn and deactivated alike, so the icons weigh less */
const fillOf = (fills: ReturnType<typeof fillsOf>): { fill: string } | ReturnType<typeof fillsOf> =>
  fills.off === fills.armed && fills.armed === fills.dead ? { fill: fills.off } : fills;

const pathOf = (points: Pt[], closed: boolean) =>
  `M${points
    .map((p) => toIcon(p))
    .map(({ x, y }) => `${x} ${y}`)
    .join(" ")}${closed ? "Z" : ""}`;

const icons = Object.fromEntries(
  iconKeys.map((key) => {
    const from = toIcon(project(key === "none" ? muzzleOf(null) : enlarge(muzzleOf(key))));
    const to = { x: size - 2, y: round(from.y + ((size - 2 - from.x) * beamDir.y) / beamDir.x) };
    const faces = facesByKey[key].map(({ box, normal, points, edges }) => {
      const attached = key !== "none" && enlarged[key].includes(box);
      return {
        d: pathOf(points, true),
        edges: edges.map((e) => pathOf(e, false)).join(" "),
        ...fillOf(fillsOf(box, normal, attached)),
        ...(attached && { attached: true as const }),
      };
    });
    return [key, { faces, beam: { from, to } }];
  }),
) as Record<
  IconKey,
  { faces: ({ d: string; edges: string; attached?: true } & ReturnType<typeof fillOf>)[]; beam: { from: Pt; to: Pt } }
>;

type Pt = { x: number; y: number };

const out = join(PROJECT_ROOT, "packages/ui/world/src/components/phaser-icon.gen.ts");
writeFileSync(
  out,
  `// Generated by \`gen-phaser-icon\` from \`service/phaser-gun.ts\`: do not edit
/**
 * The phaser bare, and with each attachment: its faces farthest first, each with its edges, and its \`fill\`, else its
 * fill put away, drawn and deactivated (\`attached\` if the attachment's), and where its beam leaves and meets the icon's edge
 */
export const phaserIcons = ${JSON.stringify(icons, null, 2)};
`,
);
execFileSync("npx", ["biome", "format", "--write", out], { cwd: PROJECT_ROOT, stdio: "ignore" });
console.log(`wrote ${out}`);

if (opts.png !== undefined) {
  const zoom = 8;
  const canvas = new Canvas(3 * size * zoom, iconKeys.length * size * zoom);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1b1f26";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (const [row, key] of iconKeys.entries())
    (["off", "armed", "dead"] as const).forEach((state, i) => {
      const { faces: iconFaces, beam } = icons[key];
      ctx.save();
      ctx.scale(zoom, zoom);
      ctx.translate(i * size, row * size);
      ctx.strokeStyle = "#2b3038";
      ctx.lineWidth = 0.5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      for (const face of iconFaces) {
        ctx.fillStyle = "fill" in face ? face.fill : face[state];
        ctx.fill(new Path2D(face.d));
        ctx.strokeStyle = face.attached ? colors.attachEdge : colors.edge;
        ctx.lineWidth = face.attached ? 0.9 : 0.5;
        ctx.stroke(new Path2D(face.edges));
      }
      if (state === "armed") {
        ctx.strokeStyle = colors.beam;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(beam.from.x, beam.from.y);
        ctx.lineTo(beam.to.x, beam.to.y);
        ctx.stroke();
      }
      ctx.restore();
    });
  await canvas.toFile(opts.png);
  console.log(`wrote ${opts.png}`);
}

function centre(b: GunBox) {
  return b.min.map((v, i) => (v + b.max[i]) / 2);
}
function mean(points: number[][]) {
  return [0, 1, 2].map((i) => points.reduce((sum, p) => sum + p[i], 0) / points.length);
}
function round(v: number) {
  return Math.round(v * 10) / 10;
}
function rgb(hex: string) {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
}
function hexOf(c: number[]) {
  return `#${c
    .map((v) =>
      Math.round(Math.min(255, Math.max(0, v)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
function shade(hex: string, k: number) {
  return hexOf(rgb(hex).map((v) => v * k));
}
function mix(a: string, b: string, t: number) {
  const [ca, cb] = [rgb(a), rgb(b)];
  return hexOf(ca.map((v, i) => v + (cb[i] - v) * t));
}
