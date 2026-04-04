#!/usr/bin/env node

/**
 * - creates public/sheets.json
 * - creates public/sheet/symbol.{sheetId}.png
 *
 * Usage
 * ```sh
 * pnpm gen-starship-sheets
 * ```
 * - assumes `public/assets.json`, `public/starship-symbol/manifest.json`
 * - reduces PNG size using `pngquant`
 *
 * We could have restricted to the rectangular bounds of obstacle polygons in
 * unflattened symbols. This would produce a much smaller `width x height`
 * but would also need to be recomputed onchange obstacle.
 * We prefer to avoid such recomputations for better DX.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  isHullSymbolImageKey,
  type StarshipSymbolImageKey,
  StarshipSymbolPngsManifestSchema,
} from "@npc-cli/media/starship-symbol";
import {
  AssetsSchema,
  SheetsSchema,
  type StarShipSymbolSheetDatum,
  type StarShipSymbolSheetEntry,
} from "@npc-cli/ui__world/assets.schema";
import { worldToSguScale } from "@npc-cli/ui__world/const";
import { Rect } from "@npc-cli/util/geom/rect";
import { safeJsonCompact } from "@npc-cli/util/legacy/generic";
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

const sheetsJsonPath = path.resolve("packages/app/public", "sheets.json");
const sheet = SheetsSchema.encode({
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

//#region sheets.{sheetId}.png

const starshipSymbolDir = path.resolve("packages/app/public/starship-symbol");
const symbolsSheetDirectory = path.resolve("packages/app/public/sheet");
mkdirSync(symbolsSheetDirectory, { recursive: true });

const baseSymbolsSheetPath = path.resolve(symbolsSheetDirectory, "symbols");

for (const [sheetId, bin] of bins.entries()) {
  const canvas = new Canvas(bin.width, bin.height);
  const ct = canvas.getContext("2d");
  // ct.fillStyle = "blue";
  // ct.fillRect(0, 0, bin.width, bin.height);

  for (const rect of bin.rects) {
    const image = await loadImage(path.resolve(starshipSymbolDir, `${rect.data.key}.png`));

    // MUST clip to the obstacles actually used e.g. diagonal part of table
    const symKey = rect.data.key as StarshipSymbolImageKey;
    const sym = assets.symbol[symKey]!;
    const scale = worldToSguScale * (isHullSymbolImageKey(symKey) ? 1 : 5);
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
  }

  await canvas.toFile(`${baseSymbolsSheetPath}.${sheetId}.png`);
}

//#endregion

process.chdir(path.resolve(PROJECT_ROOT, "packages/app/public/sheet"));
await loggedSpawn({
  label: "pngquant",
  command: "pngquant",
  args: ["--force", "--ext", ".png", "*.png"],
  shell: true,
});
