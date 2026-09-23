#!/usr/bin/env node

/**
 * Each obstacle polygon of each symbol gets its bounding rect packed into a sheet,
 * clipped to the polygon. A `dup` copy (`meta.dupOf`) shares its original's.
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
 * - `public/starship-symbol/*.png`
 * - `pngquant` command to reduce PNG size
 */

import fs, { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import assetsEncoded from "@npc-cli/app/public/assets.json" with { type: "json" };
import { isHullSymbolImageKey, type StarshipSymbolImageKey } from "@npc-cli/media/starship-symbol";
import {
  AssetsSchema,
  emptySheets,
  getObstacleSheetKey,
  SheetsSchema,
  type StarShipSymbolSheetDatum,
  type StarShipSymbolSheetEntry,
} from "@npc-cli/ui__world/assets.schema";
import { worldToSguScale } from "@npc-cli/ui__world/const.env";
import { Rect } from "@npc-cli/util/geom/rect";
import { geomService } from "@npc-cli/util/geom-service";
import { jsonParser } from "@npc-cli/util/json-parser";
import { safeJsonCompact, warn } from "@npc-cli/util/legacy/generic";
import { drawPolygons } from "@npc-cli/util/service/canvas";
import { Canvas, type Image, loadImage } from "skia-canvas";
import z from "zod";
import { PROJECT_ROOT } from "../const.ts";
import { loggedSpawn } from "../service/logged-spawn.ts";
import { packRectangles } from "../service/rects-packer.ts";
import { collectMasks } from "../service/svg-masks.ts";

const assets = z.parse(AssetsSchema, assetsEncoded);
const packedPadding = 8;
/** Less than half of `packedPadding`, so neighbours never meet */
const bleedPx = 2;

/** one per obstacle polygon of each unflattened symbol */
const obstacleRects = Object.values(assets.symbol).flatMap((sym) =>
  sym.obstacles.flatMap((poly, obstacleId) => {
    if (typeof poly.meta.dupOf === "number") return []; // shares its original's rect
    const srcRect = poly.rect.delta(-sym.bounds.x, -sym.bounds.y).scale(getSymbolPngScale(sym.key)).precision(2);
    return {
      width: Math.ceil(srcRect.width),
      height: Math.ceil(srcRect.height),
      data: { symbolKey: sym.key, obstacleId, srcRect } satisfies StarShipSymbolSheetDatum,
    };
  }),
);

const {
  bins,
  width: maxWidth,
  height: maxHeight,
} = packRectangles<StarShipSymbolSheetDatum>(obstacleRects, {
  logPrefix: "gen-starship-sheets",
  packedPadding,
  maxWidth: 4096,
  maxHeight: 4096,
});

//#region sheets.json

// other sheet-generation scripts may write to sheets.json too
const sheetsJsonPath = path.resolve("packages/app/public", "sheets.json");
const prevSheetsRaw = await fs.promises.readFile(sheetsJsonPath, "utf-8").catch(warn);
// ignore our own section, so a change to its format cannot wipe the others
const prevSheets = jsonParser.pipe(SheetsSchema.omit({ symbol: true })).safeParse(prevSheetsRaw).data ?? emptySheets;

const sheet = SheetsSchema.encode({
  ...prevSheets,
  symbol: Object.fromEntries(
    bins.flatMap((bin, sheetId) =>
      bin.rects.map<[string, StarShipSymbolSheetEntry]>(({ x, y, data: { symbolKey, obstacleId, srcRect } }) => [
        getObstacleSheetKey(symbolKey, obstacleId),
        {
          symbolKey,
          obstacleId,
          rect: Rect.fromJson({ x, y, width: srcRect.width, height: srcRect.height }),
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

const symbolImages = new Map<StarshipSymbolImageKey, Promise<Image>>();
/** can replace image -- they'll be inverted like original images */
function getSymbolImage(symbolKey: StarshipSymbolImageKey) {
  let image = symbolImages.get(symbolKey);
  if (!image) {
    const replacePath = path.resolve(starshipSymbolsReplaceDir, `${symbolKey}.png`);
    image = loadImage(existsSync(replacePath) ? replacePath : path.resolve(starshipSymbolDir, `${symbolKey}.png`));
    symbolImages.set(symbolKey, image);
  }
  return image;
}

for (const [sheetId, bin] of bins.entries()) {
  const canvas = new Canvas(bin.width, bin.height);
  const ct = canvas.getContext("2d");
  // ct.fillStyle = "blue";
  // ct.fillRect(0, 0, bin.width, bin.height);

  for (const { x, y, data } of bin.rects) {
    const { symbolKey, obstacleId, srcRect } = data;
    const sym = assets.symbol[symbolKey];
    if (!sym) {
      warn(`symbolKey not found: ${symbolKey}`);
      continue;
    }

    const image = await getSymbolImage(symbolKey);
    const scale = getSymbolPngScale(symbolKey);
    // symbol png pixels to sheet pixels
    const dx = x - srcRect.x;
    const dy = y - srcRect.y;

    // assume top-left bounds coincides with underlying image top-left
    const poly = sym.obstacles[obstacleId]
      .clone()
      .translate(-sym.bounds.x, -sym.bounds.y)
      .scale(scale)
      .translate(dx, dy);
    ct.save();
    // bled past the polygon and its rect, so edge texels are opaque — else abutting obstacles show a seam
    drawPolygons(ct as unknown as CanvasRenderingContext2D, geomService.createOutset(poly, bleedPx), {
      clip: true,
      fillStyle: "red",
      strokeStyle: null,
    });
    ct.drawImage(image, dx, dy);

    // masks are in scaled svg viewBox coords, and stay inside the clip so they can't reach a neighbour
    const masks = masksBySymbol[symbolKey];
    const offsetX = dx - sym.bounds.x * scale;
    const offsetY = dy - sym.bounds.y * scale;

    // erase "mask remove" regions
    if (masks?.remove.length) {
      ct.globalCompositeOperation = "destination-out";
      for (const maskPoly of masks.remove) {
        drawPolygons(ct as unknown as CanvasRenderingContext2D, maskPoly.clone().translate(offsetX, offsetY), {
          fillStyle: "black",
          strokeStyle: null,
        });
      }
      ct.globalCompositeOperation = "source-over";
    }

    // overwrite "mask color={color}" regions
    for (const [fillColor, maskPolys] of Object.entries(masks?.color ?? {})) {
      for (const maskPoly of maskPolys) {
        drawPolygons(ct as unknown as CanvasRenderingContext2D, maskPoly.clone().translate(offsetX, offsetY), {
          fillStyle: fillColor,
          strokeStyle: null,
        });
      }
    }
    ct.restore();
  }

  // Invert colors while preserving transparency
  const maskCanvas = new Canvas(bin.width, bin.height);
  const maskCt = maskCanvas.getContext("2d");
  maskCt.drawImage(canvas, 0, 0);
  maskCt.globalCompositeOperation = "source-in";
  maskCt.fillStyle = "#ffffff";
  // maskCt.fillStyle = "#000000";
  maskCt.fillRect(0, 0, bin.width, bin.height);
  maskCt.globalCompositeOperation = "source-over";
  ct.globalCompositeOperation = "source-over";
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

function getSymbolPngScale(symbolKey: StarshipSymbolImageKey) {
  return worldToSguScale * (isHullSymbolImageKey(symbolKey) ? 1 : 5);
}
