#!/usr/bin/env node

/**
 * Usage
 * ```sh
 * pnpm gen-starship-sheets
 * pnpm gen-starship-sheets --prod
 * ```
 * - assumes `public/assets.json`
 * - assumes `public/starship-symbol/manifest.json`
 * - "prod" flag produces smaller filesize (same dimensions)
 *
 * We could have restricted to the rectangular bounds of obstacle polygons
 * in unflattened symbols. This would produce a much smaller `width x height`
 * but would also need to be recomputed on change obstacle.
 * We prefer to avoid such recomputations e.g. for better Dev experience.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
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
import { Poly } from "@npc-cli/util/geom/poly";
import { Rect } from "@npc-cli/util/geom/rect";
import { safeJsonCompact } from "@npc-cli/util/legacy/generic";
import { drawPolygons } from "@npc-cli/util/service/skia-canvas";
import { Canvas, loadImage } from "skia-canvas";
import z from "zod";
import assetsEncoded from "../../../packages/app/public/assets.json" with { type: "json" };
import starshipSymbolManifestEncoded from "../../../packages/app/public/starship-symbol/manifest.json" with {
  type: "json",
};
import { packRectangles } from "../service/rects-packer.ts";

const {
  values: { prod },
} = parseArgs({ options: { prod: { type: "boolean", default: false } } });

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

const starshipSymbolDir = path.resolve("packages/app/public/starship-symbol");
const symbolsSheetDirectory = path.resolve("packages/app/public/sheet");
mkdirSync(symbolsSheetDirectory, { recursive: true });

const baseSymbolsSheetPath = path.resolve(symbolsSheetDirectory, prod ? "symbols.prod" : "symbols");

for (const [sheetId, bin] of bins.entries()) {
  const canvas = new Canvas(bin.width, bin.height);
  const ct = canvas.getContext("2d");

  for (const rect of bin.rects) {
    const image = await loadImage(path.resolve(starshipSymbolDir, `${rect.data.key}.png`));

    if (prod) {
      // clip to the obstacles actually used
      const symKey = rect.data.key as StarshipSymbolImageKey;
      const sym = assets.symbol[symKey]!;
      const scale = worldToSguScale * (isHullSymbolImageKey(symKey) ? 1 : 5);
      const polys = sym.obstacles.map((poly) =>
        // assume top-left bounds coincides with underlying image top-left
        poly.translate(-sym.bounds.x, -sym.bounds.y).scale(scale).translate(rect.x, rect.y),
      );
      ct.save();
      drawPolygons(ct as unknown as CanvasRenderingContext2D, Poly.union(polys), { clip: true });
    }

    ct.drawImage(image, 0, 0, rect.width, rect.height, rect.x, rect.y, rect.width, rect.height);

    if (prod) {
      ct.restore();
    }
  }

  await canvas.toFile(`${baseSymbolsSheetPath}.${sheetId}.png`);
}
