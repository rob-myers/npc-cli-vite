#!/usr/bin/env node

/**
 * creates/mutates
 * - public/sheets.json
 * creates
 * - public/sheet/symbol.{sheetId}.png
 * - public/sheet/symbol.prod.{sheetId}.png when --prod
 *
 * Usage
 * ```sh
 * pnpm gen-starship-sheets
 *
 * # smaller image for prod where obstacle editing disabled
 * pnpm gen-starship-sheets --prod
 * ```
 *
 * dependencies
 * - `public/assets.json`
 * - `public/starship-symbol/manifest.json`
 * - `pngquant` command to reduce PNG size
 *
 * This approach wastes space inside texture but avoids the need to
 * recompute the spritesheet in development.
 */

import fs, { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  isHullSymbolImageKey,
  type StarshipSymbolImageKey,
  StarshipSymbolPngsManifestSchema,
} from "@npc-cli/media/starship-symbol";
import {
  AssetsSchema,
  emptySheets,
  SheetsSchema,
  type StarShipSymbolSheetDatum,
  type StarShipSymbolSheetEntry,
} from "@npc-cli/ui__world/assets.schema";
import { worldToSguScale } from "@npc-cli/ui__world/const";
import { Rect } from "@npc-cli/util/geom/rect";
import { jsonParser } from "@npc-cli/util/json-parser";
import { safeJsonCompact, warn } from "@npc-cli/util/legacy/generic";
import { drawPolygons } from "@npc-cli/util/service/canvas";
import { Canvas, loadImage } from "skia-canvas";
import z from "zod";
import assetsEncoded from "../../..//packages/app/public/assets.json" with { type: "json" };
import starshipSymbolManifestEncoded from "../../../packages/app/public/starship-symbol/manifest.json" with {
  type: "json",
};
import { packRectangles } from "../../../scripts/src/service/rects-packer.ts";
import { PROJECT_ROOT } from "../const.ts";
import { loggedSpawn } from "../service/logged-spawn.ts";
import { collectMasks } from "../service/svg-masks.ts";

const opts = parseArgs({
  options: { prod: { type: "boolean" } },
  args: process.argv.slice(2),
});

const assets = z.parse(AssetsSchema, assetsEncoded);
const starshipSymbolManifest = z.parse(StarshipSymbolPngsManifestSchema, starshipSymbolManifestEncoded);

/** unflattened symbols with at least one obstacle */
const symbolsWithAnObstacle = Object.values(assets.symbol).filter(({ obstacles }) => obstacles.length > 0);
const manifestEntries = symbolsWithAnObstacle.map((x) => starshipSymbolManifest.byKey[x.key]);

const {
  bins,
  width: maxWidth,
  height: maxHeight,
} = packRectangles<StarShipSymbolSheetDatum>(
  manifestEntries.map(({ key, width, height, group }) => ({
    width,
    height,
    data: { key, group } satisfies StarShipSymbolSheetDatum,
  })),
  {
    logPrefix: "gen-starship-sheets",
    packedPadding: 2,
    maxWidth: 4096,
    maxHeight: 4096,
    // maxWidth: 2048,
    // maxHeight: 2048,
  },
);

//#region sheets.json

// other sheet-generation scripts may write to sheets.json too
const sheetsJsonPath = path.resolve("packages/app/public", "sheets.json");
const prevSheetsRaw = await fs.promises.readFile(sheetsJsonPath, "utf-8").catch(warn);
const prevSheets = jsonParser.pipe(SheetsSchema).safeParse(prevSheetsRaw).data ?? emptySheets;

const sheet = SheetsSchema.encode({
  ...prevSheets,
  symbol: Object.fromEntries(
    bins.flatMap((bin, sheetId) =>
      bin.rects.map<[StarshipSymbolImageKey, StarShipSymbolSheetEntry]>(({ x, y, width, height, data }) => [
        data.key,
        {
          key: data.key,
          rect: Rect.fromJson({ x, y, width, height }),
          sheetId,
        },
      ]),
    ),
  ),
  symbolSheetDims: bins.map((bin) => ({ width: bin.width, height: bin.height })),
  maxSymbolSheetDim: { width: maxWidth, height: maxHeight },
});
const nextSheetRaw = safeJsonCompact(sheet);
writeFileSync(sheetsJsonPath, nextSheetRaw);

//#endregion

//#region sheets/symbols.{sheetId}.png

const starshipSymbolDir = path.resolve("packages/app/public/starship-symbol");
const symbolsSheetDirectory = path.resolve("packages/app/public/sheet");
mkdirSync(symbolsSheetDirectory, { recursive: true });

/** symbol key → array of polygons to erase, in SVG viewBox coordinates */
const masksBySymbol = collectMasks(path.resolve(starshipSymbolDir, "mask"));

const baseSymbolsSheetPath = path.resolve(symbolsSheetDirectory, "symbols");

for (const [sheetId, bin] of bins.entries()) {
  const canvas = new Canvas(bin.width, bin.height);
  const ct = canvas.getContext("2d");
  // ct.fillStyle = "blue";
  // ct.fillRect(0, 0, bin.width, bin.height);

  for (const rect of bin.rects) {
    const image = await loadImage(path.resolve(starshipSymbolDir, `${rect.data.key}.png`));

    const symKey = rect.data.key as StarshipSymbolImageKey;
    const sym = assets.symbol[symKey]!;
    const scale = worldToSguScale * (isHullSymbolImageKey(symKey) ? 1 : 5);

    if (opts.values.prod) {
      // 🔔 clip to obstacles in production for much smaller file size
      // 🔔 we don't in development so we can add obstacles without re-running this script
      const polys = sym.obstacles.map((poly) =>
        // assume top-left bounds coincides with underlying image top-left
        poly.translate(-sym.bounds.x, -sym.bounds.y).scale(scale).translate(rect.x, rect.y),
      );

      // 🔔 issue with complex self-intersecting clipping path, so redraw per poly
      for (const poly of polys) {
        ct.save();
        drawPolygons(ct as unknown as CanvasRenderingContext2D, poly, {
          clip: true,
          fillStyle: "red",
          strokeStyle: null,
        });
        ct.drawImage(image, 0, 0, rect.width, rect.height, rect.x, rect.y, rect.width, rect.height);
        ct.restore();
      }
    } else {
      ct.drawImage(image, 0, 0, rect.width, rect.height, rect.x, rect.y, rect.width, rect.height);
    }

    // erase "mask remove" regions
    const masks = masksBySymbol[symKey];
    if (masks?.length) {
      const offsetX = rect.x - sym.bounds.x * scale;
      const offsetY = rect.y - sym.bounds.y * scale;
      ct.save();
      ct.globalCompositeOperation = "destination-out";
      for (const maskPoly of masks) {
        drawPolygons(ct as unknown as CanvasRenderingContext2D, maskPoly.translate(offsetX, offsetY), {
          fillStyle: "black",
          strokeStyle: null,
        });
      }
      ct.restore();
    }
  }

  // Invert colors while preserving transparency
  const maskCanvas = new Canvas(bin.width, bin.height);
  const maskCt = maskCanvas.getContext("2d");
  maskCt.drawImage(canvas, 0, 0);
  maskCt.globalCompositeOperation = "source-in";
  maskCt.fillStyle = "#ffffff";
  maskCt.fillRect(0, 0, bin.width, bin.height);
  maskCt.globalCompositeOperation = "source-over";
  ct.globalCompositeOperation = "difference";
  ct.drawImage(maskCanvas, 0, 0);
  ct.globalCompositeOperation = "source-over";

  await canvas.toFile(`${baseSymbolsSheetPath}.${opts.values.prod ? `prod.${sheetId}` : sheetId}.png`);
}

//#endregion

// reduce PNG size
process.chdir(path.resolve(PROJECT_ROOT, "packages/app/public/sheet"));
await loggedSpawn({
  label: "pngquant",
  command: "pngquant",
  args: ["--force", "--ext", ".png", "*.png"],
  shell: true,
});
