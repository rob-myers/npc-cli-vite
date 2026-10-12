import { loadImage } from "@npc-cli/util/legacy/dom";
import type { AssetsSkinManifestType, SheetsType, SkinEyes } from "../assets.schema";
import { type EyeFrame, eyeFrames, skinSliceDims } from "../const.both";

/** The skin sheets, each skin drawn from its svg, else its png — see `docs/skins.md` */
export function loadSkinSheets(sheets: SheetsType, manifest: AssetsSkinManifestType, cacheBust: string) {
  return loadSheets("skin", sheets.skinSheetDims, cacheBust, (cts) =>
    Object.values(sheets.skin).map(async ({ key, sheetId, rect }) => {
      const { filename, svgPath } = manifest.byKey[key] ?? {};
      if (!filename) return;
      const src = svgPath ? await fetchSkinSvgUrl(svgPath, cacheBust) : `/skin/${filename}${cacheBust}`;
      cts[sheetId].drawImage(await loadImage(src), rect.x, rect.y, rect.width, rect.height);
      URL.revokeObjectURL(src); // nothing to a url that is no blob's
    }),
  );
}

/** The slice sheets, each skin's eyes drawn every way from its face in `skinSheets` — see `docs/skin-slices.md` */
export function loadSkinSliceSheets(
  sheets: SheetsType,
  manifest: AssetsSkinManifestType,
  cacheBust: string,
  skinSheets: CanvasImageSource[],
) {
  const { cell, slice } = skinSliceDims;
  const perRow = cell / slice;
  return loadSheets("skin-slices", sheets.skinSlicesSheetDims, cacheBust, (cts) =>
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
        skinSheets[skin.sheetId],
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
  /** Scared: texels the opening grows each way, up to a width and height. Then its grey, and the pupil's size as a share of its own */
  wideGrow: 2,
  wideMax: [8, 10],
  wideWhite: 217,
  widePupil: 0.6,
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
  const { lash, gaze, wideGrow, wideMax, wideWhite, widePupil } = eyeDraw;

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
      each(ox, oy, ow, rows, (x, y) => paint(x, y, [skinX, y], y === oy + rows - 1 ? lash : 1));
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
      const growX = Math.max(0, Math.min(wideGrow, (wideMax[0] - ow) / 2));
      const growY = Math.max(0, Math.min(wideGrow, (wideMax[1] - oh) / 2));
      each(ox - growX, oy - growY, ow + 2 * growX, oh + 2 * growY, (x, y) => paint(x, y, wideWhite));
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
  dims: SheetsType["skinSheetDims"],
  cacheBust: string,
  draw: (cts: CanvasRenderingContext2D[]) => Promise<void>[],
) {
  if (!import.meta.env.DEV) {
    return Promise.all(dims.map((_, i) => loadImage(`/sheet/${name}.${i}.png${cacheBust}`)));
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

/** A blob url of the svg without its groups titled `ignore` */
async function fetchSkinSvgUrl(svgPath: string, cacheBust: string) {
  const svgText = await fetch(`/${svgPath}${cacheBust}`).then((r) => r.text());
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  for (const g of Array.from(doc.querySelectorAll("g"))) {
    if (g.querySelector(":scope > title")?.textContent?.trim() === "ignore") g.remove();
  }
  const svg = new XMLSerializer().serializeToString(doc.documentElement);
  return URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
}
