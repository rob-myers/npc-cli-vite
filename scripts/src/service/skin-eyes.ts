import type { SkinEyes } from "@npc-cli/ui__world/assets.schema";
import { Canvas, loadImage } from "skia-canvas";

type FaceRect = SkinEyes["open"];

type Rgb = [number, number, number];

const FACE = 8;
const dist = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const chroma = (rgb: Rgb) => Math.max(...rgb) - Math.min(...rgb);
const lum = ([r, g, b]: Rgb) => 0.299 * r + 0.587 * g + 0.114 * b;
const median = (values: number[]) => values.toSorted((a, b) => a - b)[values.length >> 1];

/** Tuned on the skins there are */
const tune = {
  /** How far from the skin tone a pixel must be to be something else */
  notSkin: 48,
  /** How alike a pixel and its mirror must be */
  mirror: 40,
  /** A white is grey, and no darker than this */
  whiteChroma: 12,
  whiteLum: 70,
  whiteUnderSkin: 10,
  /** A pupil is at most this bright, and this much darker than the skin */
  pupilLum: 70,
  pupilUnderSkin: 40,
  /** How alike two neighbours must be for hair to run from one into the other */
  sameHair: 32,
};

/** Finds a 64px Minecraft skin's eyes in its face front, else `null` */
export async function detectSkinEyes(pngPath: string): Promise<SkinEyes | null> {
  const image = await loadImage(pngPath);
  const ct = new Canvas(FACE, FACE).getContext("2d");
  ct.drawImage(image, FACE, FACE, FACE, FACE, 0, 0, FACE, FACE);
  const { data } = ct.getImageData(0, 0, FACE, FACE);
  const at = (x: number, y: number): Rgb => [0, 1, 2].map((i) => data[(y * FACE + x) * 4 + i]) as Rgb;

  // the cheeks and nose, where most of a face is skin
  const middle = [2, 3, 4, 5, 6].flatMap((y) => [2, 3, 4, 5].map((x) => at(x, y)));
  const skin = [0, 1, 2].map((i) => median(middle.map((rgb) => rgb[i]))) as Rgb;

  /** In the left half, below the hairline and off the face's edge, and matched by its mirror */
  const cells = [2, 3, 4, 5, 6]
    .flatMap((y) => [1, 2, 3].map((x) => ({ x, y, rgb: at(x, y) })))
    .filter(({ x, y, rgb }) => dist(rgb, at(FACE - 1 - x, y)) < tune.mirror);
  const isPupil = (rgb: Rgb) =>
    dist(rgb, skin) > tune.notSkin && lum(rgb) < tune.pupilLum && lum(skin) - lum(rgb) > tune.pupilUnderSkin;
  /** Grey, where the skin is not, or else far from it */
  const isWhite = (rgb: Rgb) =>
    chroma(rgb) < tune.whiteChroma &&
    lum(rgb) > tune.whiteLum &&
    (dist(rgb, skin) > tune.notSkin || chroma(skin) - chroma(rgb) > tune.whiteUnderSkin);

  const whites = cells.filter(({ rgb }) => isWhite(rgb));
  // the pupils are the dark beside the whites, on their rows
  const pupils = cells.filter(
    ({ x, y, rgb }) => isPupil(rgb) && whites.some((white) => white.y === y && Math.abs(white.x - x) === 1),
  );
  if (pupils.length > 0) return { open: boundsOf([...whites, ...pupils]), pupil: boundsOf(pupils) };

  // dot eyes: the dark that hair reaching in from the edge does not account for
  const hair = new Set<string>();
  const spread = (x: number, y: number, from: Rgb) => {
    const key = `${x},${y}`;
    if (x < 0 || y < 0 || x >= FACE || y >= FACE || hair.has(key)) return;
    const rgb = at(x, y);
    if (dist(rgb, skin) <= tune.notSkin || dist(rgb, from) > tune.sameHair) return;
    hair.add(key);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) spread(x + dx, y + dy, rgb); // biome-ignore format: succinct
  };
  for (let i = 0; i < FACE; i++) for (const [x, y] of [[i, 0], [0, i], [FACE - 1, i]]) spread(x, y, at(x, y)); // biome-ignore format: succinct
  const dots = cells.filter(({ x, y, rgb }) => isPupil(rgb) && hair.has(`${x},${y}`) === false);
  if (dots.length === 0) return null;
  const pupil = boundsOf(dots);
  return { open: pupil, pupil };
}

function boundsOf(cells: { x: number; y: number }[]): FaceRect {
  const xs = cells.map(({ x }) => x);
  const ys = cells.map(({ y }) => y);
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  return [x, y, Math.max(...xs) - x + 1, Math.max(...ys) - y + 1];
}
