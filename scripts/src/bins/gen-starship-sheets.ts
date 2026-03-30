#!/usr/bin/env node

/**
 * Usage
 * ```sh
 * pnpm gen-starship-sheets
 * ```
 * Assuming `public/assets.json`, `public/starship-symbol/manifest.json` exists
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import { type StarshipSymbolImageKey, StarshipSymbolPngsManifestSchema } from "@npc-cli/media/starship-symbol";
import { AssetsSchema, SheetsSchema } from "@npc-cli/ui__world/assets.schema";
import { Rect } from "@npc-cli/util/geom/rect";
import { safeJsonCompact } from "@npc-cli/util/legacy/generic";
import z from "zod";
import assetsEncoded from "../../../packages/app/public/assets.json" with { type: "json" };
import starshipSymbolManifestEncoded from "../../../packages/app/public/starship-symbol/manifest.json" with {
  type: "json",
};
import packRectangles from "../service/rects-packer.ts";

const assets = z.parse(AssetsSchema, assetsEncoded);
const starshipSymbolManifest = z.parse(StarshipSymbolPngsManifestSchema, starshipSymbolManifestEncoded);

/** unflattened symbols with at least one obstacle */
const symbolsWithAnObstacle = Object.values(assets.symbol).filter(({ obstacles }) => obstacles.length > 0);
const manifestEntries = symbolsWithAnObstacle.map((x) => starshipSymbolManifest.byKey[x.key]);

type SpriteSheetEntryDatum = { key: StarshipSymbolImageKey; group: string };

const {
  bins,
  width: maxWidth,
  height: maxHeight,
} = packRectangles<SpriteSheetEntryDatum>(
  manifestEntries.map(({ key, width, height, group }) => ({
    width,
    height,
    data: { key, group },
  })),
  {
    logPrefix: "gen-starship-sheets",
    packedPadding: 2,
    maxWidth: 4096,
    maxHeight: 4096,
  },
);

const sheetsJsonPath = path.resolve("packages/app/public", "sheets.json");

const sheet = SheetsSchema.encode({
  symbol: Object.fromEntries(
    bins.flatMap((bin) =>
      bin.rects.map(({ x, y, width, height, data }) => [
        data.key,
        {
          key: data.key,
          rect: Rect.fromJson({ x, y, width, height }),
        },
      ]),
    ),
  ),
  obstacleDims: bins.map((bin) => ({ width: bin.width, height: bin.height })),
  maxObstacleDim: { width: maxWidth, height: maxHeight },
});

const nextSheetRaw = safeJsonCompact(sheet);
writeFileSync(sheetsJsonPath, nextSheetRaw);
