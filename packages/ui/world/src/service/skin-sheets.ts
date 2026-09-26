import { loadImage } from "@npc-cli/util/legacy/dom";
import type { AssetsSkinManifestType, SheetsType } from "../assets.schema";

/** The skin sheets: drawn in DEV (see `drawSkinSheets`), else the pngs it saved — see `docs/skins.md` */
export function loadSkinSheets(sheets: SheetsType, manifest: AssetsSkinManifestType, cacheBust: string) {
  return import.meta.env.DEV
    ? drawSkinSheets(sheets, manifest, cacheBust)
    : Promise.all(sheets.skinSheetDims.map((_, i) => loadImage(`/sheet/skin.${i}.png${cacheBust}`)));
}

/** Each skin sheet drawn from its skins' svgs, else pngs, and sent to be saved for a build */
async function drawSkinSheets(sheets: SheetsType, manifest: AssetsSkinManifestType, cacheBust: string) {
  const canvases = sheets.skinSheetDims.map((dims) => Object.assign(document.createElement("canvas"), dims));
  await Promise.all(
    Object.values(sheets.skin).map(async ({ key, sheetId, rect }) => {
      const { filename, svgPath } = manifest.byKey[key] ?? {};
      if (!filename) return;
      const src = svgPath ? await fetchSkinSvgUrl(svgPath, cacheBust) : `/skin/${filename}${cacheBust}`;
      try {
        const ct = canvases[sheetId].getContext("2d") as CanvasRenderingContext2D;
        ct.imageSmoothingEnabled = false;
        ct.drawImage(await loadImage(src), rect.x, rect.y, rect.width, rect.height);
      } finally {
        if (svgPath) URL.revokeObjectURL(src);
      }
    }),
  );
  canvases.forEach((canvas, sheetId) =>
    canvas.toBlob((png) => png && fetch(`/api/skin-sheet/${sheetId}`, { method: "POST", body: png })),
  );
  return canvases;
}

/** A blob url of the svg without its groups titled `ignore` */
async function fetchSkinSvgUrl(svgPath: string, cacheBust: string) {
  const svgText = await fetch(`/${svgPath}${cacheBust}`).then((r) => r.text());
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  for (const g of doc.querySelectorAll("g")) {
    if (g.querySelector(":scope > title")?.textContent?.trim() === "ignore") g.remove();
  }
  const svg = new XMLSerializer().serializeToString(doc.documentElement);
  return URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
}
