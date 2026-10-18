import type { SkinEyes } from "@npc-cli/ui__world/assets.schema";
import { Canvas, loadImage } from "skia-canvas";

type Rgb = [number, number, number];
type Cell = { x: number; y: number; rgb: Rgb };

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
  /** At most this bright is dark: a pupil, or the black of an inverted eye */
  dark: 60,
  /** At most this colourful is grey, a white if the skin is not grey too. An iris is at least `iris` */
  grey: 12,
  iris: 80,
};

/** Finds a 64px Minecraft skin's eyes in its face front, else `null` — see `docs/skin-slices.md` */
export async function detectSkinEyes(pngPath: string): Promise<SkinEyes | null> {
  const ct = new Canvas(FACE, FACE).getContext("2d");
  ct.drawImage(await loadImage(pngPath), FACE, FACE, FACE, FACE, 0, 0, FACE, FACE);
  const { data } = ct.getImageData(0, 0, FACE, FACE);
  const at = (x: number, y: number): Rgb => [0, 1, 2].map((i) => data[(y * FACE + x) * 4 + i]) as Rgb;

  // the cheeks and nose, where most of a face is skin
  const middle = [2, 3, 4, 5, 6].flatMap((y) => [2, 3, 4, 5].map((x) => at(x, y)));
  const skin = [0, 1, 2].map((i) => median(middle.map((rgb) => rgb[i]))) as Rgb;
  const isDark = (rgb: Rgb) => lum(rgb) < tune.dark;
  const isPupil = ({ rgb }: Cell) => isDark(rgb) && dist(rgb, skin) > tune.notSkin;
  const isWhite = ({ rgb }: Cell) => chroma(rgb) < tune.grey && chroma(skin) > tune.grey && isDark(rgb) === false;

  /** The left half, below the hairline and off the face's edge, where its mirror matches */
  const cells: Cell[] = [2, 3, 4, 5, 6]
    .flatMap((y) => [1, 2, 3].map((x) => ({ x, y, rgb: at(x, y) })))
    .filter(({ x, y, rgb }) => dist(rgb, at(FACE - 1 - x, y)) < tune.mirror);

  // whites, with the pupils what is neither skin nor white beside them on their rows, e.g. a pale iris
  const whites = cells.filter(isWhite);
  const pupils = cells.filter(
    (cell) =>
      isWhite(cell) === false &&
      dist(cell.rgb, skin) > tune.notSkin &&
      whites.some((white) => white.y === cell.y && Math.abs(white.x - cell.x) === 1),
  );
  if (pupils.length > 0) return { open: boundsOf([...whites, ...pupils]), pupil: boundsOf(pupils) };

  // inverted eyes: a coloured iris with dark on every side, the eye being both
  const irises = cells.filter(
    ({ x, y, rgb }) =>
      chroma(rgb) > tune.iris &&
      isDark(at(x + 1, y)) &&
      isDark(at(x - 1, y)) &&
      isDark(at(x, y + 1)) &&
      isDark(at(x, y - 1)),
  );
  if (irises.length > 0) {
    const [x, y, width, height] = boundsOf(irises);
    return { open: [x - 1, y - 1, width + 2, height + 2], pupil: [x, y, width, height] };
  }

  // dot eyes: whatever else is dark
  const dots = cells.filter(isPupil);
  return dots.length > 0 ? { open: boundsOf(dots), pupil: boundsOf(dots) } : null;
}

function boundsOf(cells: { x: number; y: number }[]): SkinEyes["open"] {
  const xs = cells.map(({ x }) => x);
  const ys = cells.map(({ y }) => y);
  const [x, y] = [Math.min(...xs), Math.min(...ys)];
  return [x, y, Math.max(...xs) - x + 1, Math.max(...ys) - y + 1];
}
