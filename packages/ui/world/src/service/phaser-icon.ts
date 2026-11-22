/**
 * The hud's phaser icons, bare and with each attachment, projected from the gun's boxes (`phaser-gun.ts`) as the
 * module loads. Fitted alike, so the gun keeps its size whatever is fitted. jsh-free and three-free, so a script can
 * draw them too (`gen-phaser-icon --png`)
 */
import {
  attachmentBoxes,
  type GunAttachment,
  type GunBox,
  type GunFace,
  gunAttachments,
  gunBoxes,
  gunColors,
  gunFaces,
  isHole,
  muzzleOf,
} from "./phaser-gun.ts";

export type PhaserIconKey = "none" | GunAttachment;
export const phaserIconKeys: PhaserIconKey[] = ["none", ...gunAttachments];

/** Its size, and its edges' widths: an attachment's bolder */
export const phaserIconConfig = {
  size: 64,
  edgeWidth: 0.5,
  attachEdgeWidth: 0.9,
} as const;

/** Degrees the view turns from side-on towards the muzzle, and looks down */
const [azimuth, elevation] = [(38 * Math.PI) / 180, (28 * Math.PI) / 180];
const [ca, sa, ce, se] = [Math.cos(azimuth), Math.sin(azimuth), Math.cos(elevation), Math.sin(elevation)];
/** The room kept round the gun, and how far right it sits to leave the beam room */
const [margin, shift] = [6, -6];
const { size } = phaserIconConfig;

/** Screen `x` right and `y` down, and depth towards the eye, of a point in the forearm's frame */
const project = ([x, y, z]: number[]) => {
  const [f, s, u] = [-y, z, x]; // forward, side and up
  return { x: f * ca - s * sa, y: f * sa * se + s * ca * se - u * ce, depth: f * sa * ce + s * ca * ce + u * se };
};

/** Towards the eye, in the forearm's frame: faces turned this way are seen */
const eye = [se, -sa * ce, ca * ce];
const facing = (n: number[]) => n[0] * eye[0] + n[1] * eye[1] + n[2] * eye[2] > 1e-6;
const inside = (p: number[], b: GunBox) => p.every((v, i) => v > b.min[i] + 1e-6 && v < b.max[i] - 1e-6);

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
const boxesOf = (key: PhaserIconKey) =>
  key === "none" ? gunBoxes : [...gunBoxes.filter((box) => box.under !== true), ...enlarged[key]];

/**
 * Each box's faces turned to the eye, bar those buried in another box: farthest box first, with its edges to draw.
 * Holes come last: they sit proud of a face that, by its middle, may be nearer
 */
const facesOf = (boxes: GunBox[]) =>
  [...boxes]
    .sort((a, b) => Number(isHole(a)) - Number(isHole(b)) || project(centre(a)).depth - project(centre(b)).depth)
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

const facesByKey = Object.fromEntries(phaserIconKeys.map((key) => [key, facesOf(boxesOf(key))])) as Record<
  PhaserIconKey,
  ReturnType<typeof facesOf>
>;

// fitted to the icon alike, a little left of centre
const allPoints = Object.values(facesByKey).flatMap((faces) => faces.flatMap((f) => f.points));
const [minX, maxX] = [Math.min(...allPoints.map((p) => p.x)), Math.max(...allPoints.map((p) => p.x))];
const [minY, maxY] = [Math.min(...allPoints.map((p) => p.y)), Math.max(...allPoints.map((p) => p.y))];
const scale = (size - 2 * margin) / Math.max(maxX - minX, maxY - minY);
const toIcon = ({ x, y }: Pt) => ({
  x: round((x - (minX + maxX) / 2) * scale + size / 2 + shift),
  y: round((y - (minY + maxY) / 2) * scale + size / 2),
});

/** The beam along the barrel to the icon's right edge */
const beamDir = { x: ca, y: sa * se };

/** Lit from above, as the gun is: brightest on top, darkest at the ends. And an emitter's glow */
const faceShade = (n: number[]) => 1 + 0.32 * n[0] - 0.26 * Math.abs(n[1]);
const glowShade = (n: number[]) => 1 + 0.15 * n[0] - 0.15 * Math.abs(n[1]);

/** A face's fill put away and drawn. An attachment is white, untoned, its emitters holes */
const fillsOf = ({ kind, tone }: GunBox, n: number[], attached: boolean) => {
  const body = attached ? shade(gunColors.attach, faceShade(n)) : shade(gunColors.iconGun, tone * faceShade(n));
  if (kind === "emitter") {
    const off = attached ? shade(gunColors.hole, faceShade(n)) : body;
    return { off, armed: shade(gunColors.beam, glowShade(n)) };
  }
  if (kind === "strip") {
    const slot = shade(gunColors.slot, faceShade(n));
    return { off: slot, armed: mix(slot, gunColors.beam, 0.55) };
  }
  return { off: body, armed: body };
};

type Fills = ReturnType<typeof fillsOf>;
/** One `fill` where put away and drawn alike */
const fillOf = (fills: Fills): { fill: string } | Fills => (fills.off === fills.armed ? { fill: fills.off } : fills);

const pathOf = (points: Pt[], closed: boolean) =>
  `M${points
    .map((p) => toIcon(p))
    .map(({ x, y }) => `${x} ${y}`)
    .join(" ")}${closed ? "Z" : ""}`;

/**
 * By key, its faces farthest first: each its path, its edges, and its `fill`, else its fill put away and drawn
 * (`attached` if the attachment's). And where its beam leaves and meets the icon's edge
 */
export const phaserIcons = Object.fromEntries(
  phaserIconKeys.map((key) => {
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
) as Record<PhaserIconKey, PhaserIcon>;

export type PhaserIcon = {
  faces: ({ d: string; edges: string; attached?: true } & ({ fill: string } | Fills))[];
  beam: { from: Pt; to: Pt };
};

type Pt = { x: number; y: number };

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
  const [x, y] = [rgb(a), rgb(b)];
  return hexOf(x.map((v, i) => v + (y[i] - v) * t));
}
