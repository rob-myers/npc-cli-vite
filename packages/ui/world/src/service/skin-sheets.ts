import { loadImage } from "@npc-cli/util/legacy/dom";
import { type AssetsSkinManifestType, getSheetUrl, type SheetsType, type SkinEyes } from "../assets.schema";
import { type EyeFrame, eyeFrames, skinSliceDims } from "../const.both";

/** The skin sheets, each skin drawn from its svg, else its png — see `docs/skins.md` */
function loadSkinSheets(sheets: SheetsType, manifest: AssetsSkinManifestType, cacheBust: string) {
  return loadSheets("skin", sheets, sheets.skinSheetDims, cacheBust, (cts) =>
    Object.values(sheets.skin).map(async ({ key, sheetId, rect }) => {
      const { filename, svgPath } = manifest.byKey[key] ?? {};
      if (!filename) return;
      const image = svgPath
        ? await rasterSkinSvg(svgPath, cacheBust, rect.width)
        : await loadImage(`/skin/${filename}${cacheBust}`);
      cts[sheetId].drawImage(image, rect.x, rect.y, rect.width, rect.height);
    }),
  );
}

/** Each skin sheet as it loads: a World waits for sheet 0 alone, which holds the skins worn at boot */
export function loadSkinSheetsEach(sheets: SheetsType, manifest: AssetsSkinManifestType, cacheBust: string) {
  if (!import.meta.env.DEV) {
    return sheets.skinSheetDims.map((_, i) => loadImage(getSheetUrl(sheets, `skin.${i}.png`, cacheBust)));
  }
  const all = loadSkinSheets(sheets, manifest, cacheBust);
  return sheets.skinSheetDims.map((_, i) => all.then((images) => images[i]));
}

/** A black body for a skin whose sheet is still loading: its base faces opaque, its overlay and unused corner clear */
export function drawLoadingSkin(ct: CanvasRenderingContext2D, width: number, height: number) {
  const k = width / 64;
  ct.fillStyle = "#000";
  ct.fillRect(0, 0, width, height);
  for (const [x, y, w, h] of loadingSkinClear) ct.clearRect(x * k, y * k, w * k, h * k);
}

/** In skin texels: the head's unused corner, then each overlay */
const loadingSkinClear = [
  [0, 0, 8, 4],
  [32, 0, 32, 16],
  [0, 32, 56, 16],
  [0, 48, 16, 16],
  [48, 48, 16, 16],
];

/** The slice sheets, each skin's eyes drawn every way from its face in `skinSheets` — see `docs/skin-slices.md` */
export function loadSkinSliceSheets(
  sheets: SheetsType,
  manifest: AssetsSkinManifestType,
  cacheBust: string,
  skinSheets: Promise<CanvasImageSource>[],
) {
  const { cell, slice } = skinSliceDims;
  const perRow = cell / slice;
  return loadSheets("skin-slices", sheets, sheets.skinSlicesSheetDims, cacheBust, (cts) =>
    Object.values(sheets.skinSlices).map(async ({ key, sheetId, rect }) => {
      const eyes = manifest.byKey[key]?.meta.eyes as undefined | SkinEyes;
      const skin = sheets.skin[key];
      if (eyes === undefined || skin === undefined) return;
      // the face front, an eighth of the skin in from its corner
      const { x, y, width, height } = skin.rect;
      const faceCt = Object.assign(document.createElement("canvas"), { width: slice, height: slice }).getContext("2d");
      if (faceCt === null) return;
      faceCt.imageSmoothingEnabled = false;
      faceCt.drawImage(
        await skinSheets[skin.sheetId],
        x + width / 8,
        y + height / 8,
        width / 8,
        height / 8,
        0,
        0,
        slice,
        slice,
      );
      const face = faceCt.getImageData(0, 0, slice, slice);
      eyeFrames.forEach((frame, i) =>
        cts[sheetId].putImageData(
          drawEyes(frame, face, eyes),
          rect.x + (i % perRow) * slice,
          rect.y + Math.floor(i / perRow) * slice,
        ),
      );
    }),
  );
}

/** How the eyes are drawn — see `drawEyes` */
const eyeDraw = {
  /** How dark a lid's lower edge is, as a share of the skin */
  lash: 0.3,
  /** Texels a pupil moves to look aside or up */
  gaze: 2,
  /** Scared: the opening grows up by this share of its height, and the pupil's size as a share of its own */
  wideUp: 0.25,
  widePupil: 0.8,
};

/**
 * Both of a skin's eyes one way, over a clear slice. Its colours are the face's own: skin is the
 * texel beside the eye towards the nose, on the same row
 */
function drawEyes(frame: EyeFrame, face: ImageData, eyes: SkinEyes) {
  const size = face.width;
  const out = new ImageData(size, size);
  const [ox, oy, ow, oh] = eyes.open.map((value) => (value * size) / 8);
  const [px, py, pw, ph] = eyes.pupil.map((value) => (value * size) / 8);
  const inOpen = (x: number, y: number) => x >= ox && x < ox + ow && y >= oy && y < oy + oh;
  const skinX = ox + ow + size / 16;
  /** A column of the white beside the pupil. A dot eye has none, so skin shows instead */
  const whiteX = Math.floor(px > ox ? (ox + px) / 2 : px + pw < ox + ow ? (px + pw + ox + ow) / 2 : skinX);
  const { lash, gaze, wideUp, widePupil } = eyeDraw;

  /** An eye that is dark around a bright iris, which keeps its dark */
  const centreRow = Math.floor(oy + oh / 2);
  const lumAt = (x: number, y: number) =>
    face.data
      .subarray((y * size + x) * 4)
      .slice(0, 3)
      .reduce((a, b) => a + b);
  const inverted = lumAt(whiteX, centreRow) < lumAt(Math.floor(px + pw / 2), Math.floor(py + ph / 2));

  // the left eye as seen, then its mirror
  for (const mirror of [false, true]) {
    const at = (x: number, y: number) => (y * size + (mirror ? size - 1 - x : x)) * 4;
    /** Takes the face's texel at `from`, or a grey */
    const paint = (x: number, y: number, from: number | [number, number], shade = 1) => {
      if (x < 0 || y < 0 || x >= size || y >= size) return;
      const to = at(x, y);
      for (let c = 0; c < 3; c++)
        out.data[to + c] = typeof from === "number" ? from : face.data[at(...from) + c] * shade;
      out.data[to + 3] = 255;
    };
    const each = (x0: number, y0: number, w: number, h: number, draw: (x: number, y: number) => void) => {
      for (let y = Math.round(y0); y < Math.round(y0 + h); y++)
        for (let x = Math.round(x0); x < Math.round(x0 + w); x++) draw(x, y);
    };
    /** The lid down over `rows` of the opening, its lower edge dark */
    const lid = (rows: number) =>
      each(ox, oy, ow, rows, (x, y) => {
        const bottom = y === oy + rows - 1;
        // a dark eye's lid would be lost in the face, so the eye's dark stays as its outline
        const edge = inverted && (bottom || y === oy || x === ox || x === ox + ow - 1);
        paint(x, y, edge ? [whiteX, y] : [skinX, y], bottom && edge === false ? lash : 1);
      });
    /** The opening all white, then the pupil moved within it. The mirror's `dx` is the other way */
    const look = (dx: number, dy: number) => {
      each(ox, oy, ow, oh, (x, y) => paint(x, y, [whiteX, y]));
      const shift = mirror ? -dx : dx;
      each(px, py, pw, ph, (x, y) => inOpen(x + shift, y + dy) && paint(x + shift, y + dy, [x, y]));
    };

    if (frame === "half") lid(oh / 2);
    if (frame === "shut") lid(oh);
    if (frame === "up") look(0, -gaze);
    if (frame === "left") look(-gaze, 0);
    if (frame === "right") look(gaze, 0);
    if (frame === "none") each(ox, oy, ow, oh, (x, y) => paint(x, y, [skinX, y]));
    if (frame === "scared") {
      // the lids lift, the eye's own white showing above the iris: no wider or paler, so each skin keeps its eyes
      const up = Math.round(oh * wideUp);
      each(ox, oy - up, ow, oh + up, (x, y) => paint(x, y, [whiteX, inverted ? centreRow : Math.max(y, oy)]));
      const [w, h] = [pw * widePupil, ph * widePupil];
      const centre: [number, number] = [Math.floor(px + pw / 2), Math.floor(py + ph / 2)];
      each(px + (pw - w) / 2, py + (ph - h) / 2, w, h, (x, y) => paint(x, y, centre));
    }
  }
  return out;
}

/** The sheets of `name`: in DEV drawn by `draw` and sent to be saved, else the pngs that saved */
async function loadSheets(
  name: "skin" | "skin-slices",
  sheets: SheetsType,
  dims: SheetsType["skinSheetDims"],
  cacheBust: string,
  draw: (cts: CanvasRenderingContext2D[]) => Promise<void>[],
) {
  if (!import.meta.env.DEV) {
    return Promise.all(dims.map((_, i) => loadImage(getSheetUrl(sheets, `${name}.${i}.png`, cacheBust))));
  }
  const canvases = dims.map((dim) => Object.assign(document.createElement("canvas"), dim));
  const cts = canvases.map((canvas) => canvas.getContext("2d") as CanvasRenderingContext2D);
  for (const ct of cts) ct.imageSmoothingEnabled = false;
  await Promise.all(draw(cts));
  // the dev server writes `public/sheet/{name}.{sheetId}.png`
  canvases.forEach((canvas, sheetId) =>
    canvas.toBlob((png) => png && fetch(`/api/${name}-sheet/${sheetId}`, { method: "POST", body: png })),
  );
  return canvases;
}

/**
 * An svg skin drawn at `size`, without its groups titled `ignore`. Drawn once per version of its text, so a refetch,
 * e.g. after a hot reload, redraws only the svgs that changed: drawing them all at once hitched the page
 */
async function rasterSkinSvg(svgPath: string, cacheBust: string, size: number) {
  const svgText = await fetch(`/${svgPath}${cacheBust}`).then((r) => r.text());
  const version = `${size} ${hashText(svgText)}`;
  const cached = svgRasters.get(svgPath);
  if (cached?.version === version) return cached.canvas;
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  for (const g of Array.from(doc.querySelectorAll("g"))) {
    if (g.querySelector(":scope > title")?.textContent?.trim() === "ignore") g.remove();
  }
  const svg = new XMLSerializer().serializeToString(doc.documentElement);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const canvas = Object.assign(document.createElement("canvas"), { width: size, height: size });
  canvas.getContext("2d")?.drawImage(await loadImage(url), 0, 0, size, size);
  URL.revokeObjectURL(url);
  svgRasters.set(svgPath, { version, canvas });
  return canvas;
}

/** A 32-bit FNV-1a hash of `text`, to tell one version of an svg from another */
function hashText(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(36);
}

/** Each svg skin's raster in DEV, by path, with the version of its text it was drawn from */
const svgRasters = new Map<string, { version: string; canvas: HTMLCanvasElement }>();
