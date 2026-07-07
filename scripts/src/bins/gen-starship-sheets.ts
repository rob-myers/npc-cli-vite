#!/usr/bin/env node

/**
 * Each symbol with at least one obstacle gets packed into a sheet.
 * We also erase the parts of the symbol which are not obstacles.
 * This can waste space for some symbols e.g. bridge--042.
 * However, it should be a bit faster than splitting into many obstacles,
 * and won't change as much as one adds obstacles to symbols.
 *
 * creates/mutates
 * - public/sheets.json
 * creates
 * - public/sheet/symbol.{sheetId}.png
 *
 * Usage
 * ```sh
 * pnpm gen-starship-sheets
 * ```
 *
 * dependencies
 * - `public/assets.json`
 * - `public/starship-symbol/manifest.json`
 * - `pngquant` command to reduce PNG size
 */

import fs, { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import assetsEncoded from "@npc-cli/app/public/assets.json" with { type: "json" };
import starshipSymbolManifestEncoded from "@npc-cli/app/public/starship-symbol/manifest.json" with { type: "json" };
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
import { PROJECT_ROOT } from "../const.ts";
import { loggedSpawn } from "../service/logged-spawn.ts";
import { packRectangles } from "../service/rects-packer.ts";
import { collectMasks } from "../service/svg-masks.ts";

const assets = z.parse(AssetsSchema, assetsEncoded);
const starshipSymbolManifest = z.parse(StarshipSymbolPngsManifestSchema, starshipSymbolManifestEncoded);

/** unflattened symbols with at least one obstacle */
const symbolsWithAtLeastOneObstacle = Object.values(assets.symbol).filter(({ obstacles }) => obstacles.length > 0);
const manifestEntries = symbolsWithAtLeastOneObstacle.map((x) => starshipSymbolManifest.byKey[x.key]);

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

const starshipSymbolsReplaceDir = path.resolve(starshipSymbolDir, "replace");
const starshipSymbolsMasksDir = path.resolve(starshipSymbolDir, "mask");
const baseSymbolsSheetPath = path.resolve(symbolsSheetDirectory, "symbols");

/** "symbol key" to array of polygons to erase/color, in SVG viewBox coordinates */
const masksBySymbol = collectMasks(starshipSymbolsMasksDir);

for (const [sheetId, bin] of bins.entries()) {
  const canvas = new Canvas(bin.width, bin.height);
  const ct = canvas.getContext("2d");
  // ct.fillStyle = "blue";
  // ct.fillRect(0, 0, bin.width, bin.height);

  for (const rect of bin.rects) {
    // can replace image
    const image = await loadImage(
      existsSync(path.resolve(starshipSymbolsReplaceDir, `${rect.data.key}.png`))
        ? path.resolve(starshipSymbolsReplaceDir, `${rect.data.key}.png`)
        : path.resolve(starshipSymbolDir, `${rect.data.key}.png`),
    );

    const symKey = rect.data.key as StarshipSymbolImageKey;
    const sym = assets.symbol[symKey];
    if (!sym) continue;
    const scale = worldToSguScale * (isHullSymbolImageKey(symKey) ? 1 : 5);

    // 🔔 clip to obstacles for much smaller file size
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

    const masks = masksBySymbol[symKey];

    // erase "mask remove" regions
    const offsetX = rect.x - sym.bounds.x * scale;
    const offsetY = rect.y - sym.bounds.y * scale;

    if (masks?.remove.length) {
      ct.save();
      ct.globalCompositeOperation = "destination-out";
      for (const maskPoly of masks.remove) {
        drawPolygons(ct as unknown as CanvasRenderingContext2D, maskPoly.translate(offsetX, offsetY), {
          fillStyle: "black",
          strokeStyle: null,
        });
      }
      ct.restore();
    }

    // overwrite "mask color={color}" regions
    for (const [fillColor, maskPolys] of Object.entries(masks?.color ?? {})) {
      for (const maskPoly of maskPolys) {
        drawPolygons(ct as unknown as CanvasRenderingContext2D, maskPoly.translate(offsetX, offsetY), {
          fillStyle: fillColor,
          strokeStyle: null,
        });
      }
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

  await canvas.toFile(`${baseSymbolsSheetPath}.${sheetId}.png`);
}

//#endregion

// reduce PNG size
try {
  process.chdir(path.resolve(PROJECT_ROOT, "packages/app/public/sheet"));
  await loggedSpawn({
    label: "pngquant",
    command: "pngquant",
    args: ["--force", "--ext", ".png", "*.png"],
    shell: true,
  });
} catch (e) {
  warn(`pngquant failed to optimize PNGs: have you installed it?`);
  warn(e);
}
