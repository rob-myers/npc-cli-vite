#!/usr/bin/env node

/**
 * creates/mutates
 * - public/sheets.json (skin fields)
 *
 * Usage
 * ```sh
 * pnpm exec gen-skin-sheets
 * ```
 *
 * dependencies
 * - `public/skin/manifest.json` (rebuilt by this script)
 *
 * Only the layout: a DEV World draws `public/sheet/skin.{sheetId}.png` and saves it — see `docs/skins.md`
 */

import fs, { writeFileSync } from "node:fs";
import path from "node:path";
import {
  AssetsSkinManifestSchema,
  emptySheets,
  SheetsSchema,
  type SkinSheetEntry,
} from "@npc-cli/ui__world/assets.schema";
import { Rect } from "@npc-cli/util/geom/rect";
import { jsonParser } from "@npc-cli/util/json-parser";
import { safeJsonCompact, warn } from "@npc-cli/util/legacy/generic";
import type { Rectangle } from "maxrects-packer";
import { PROJECT_ROOT } from "../const.ts";
import { packRectangles } from "../service/rects-packer.ts";
import { rebuildSkinManifest } from "../service/watch-skin-pngs.ts";

/** A 64px Minecraft skin, drawn at the 256px of its svg overlay — see `drawSkinSheets` */
const skinSheetCellSize = 256;

// 1. rebuild manifest
await rebuildSkinManifest();

// 2. read manifest
const skinDir = path.resolve(PROJECT_ROOT, "packages/app/public/skin");
const manifestRaw = fs.readFileSync(path.join(skinDir, "manifest.json"), "utf-8");
const manifest = jsonParser.pipe(AssetsSkinManifestSchema).parse(manifestRaw);
const entries = Object.values(manifest.byKey);

if (entries.length === 0) {
  console.log("gen-skin-sheets: no skin entries found");
  process.exit(0);
}

type RectangleData = { key: string; filename: string; originalWidth: number; originalHeight: number };

// 3. pack skin pngs
const {
  bins,
  width: maxWidth,
  height: maxHeight,
} = packRectangles<RectangleData>(
  entries.map(({ key, filename }) => ({
    width: skinSheetCellSize,
    height: skinSheetCellSize,
    data: { key, filename, originalWidth: 64, originalHeight: 64 },
  })),
  {
    logPrefix: "gen-skin-sheets",
    packedPadding: 2,
    maxWidth: 4096,
    maxHeight: 4096,
  },
);

// 4. update sheets.json
const sheetsJsonPath = path.resolve(PROJECT_ROOT, "packages/app/public", "sheets.json");
const prevSheetsRaw = await fs.promises.readFile(sheetsJsonPath, "utf-8").catch(warn);
const prevSheets = jsonParser.pipe(SheetsSchema).safeParse(prevSheetsRaw).data ?? emptySheets;

const sheet = SheetsSchema.encode({
  ...prevSheets,
  skin: Object.fromEntries(
    bins.flatMap((bin, sheetId) =>
      bin.rects.map<[string, SkinSheetEntry]>(
        ({ x, y, width, height, data }: Omit<Rectangle, "data"> & { data: RectangleData }) => [
          data.key,
          {
            key: data.key,
            filename: data.filename,
            rect: Rect.fromJson({ x, y, width, height }),
            sheetId,
            originalWidth: data.originalWidth,
            originalHeight: data.originalHeight,
          },
        ],
      ),
    ),
  ),
  skinSheetDims: bins.map((bin) => ({ width: bin.width, height: bin.height })),
  maxSkinSheetDim: { width: maxWidth, height: maxHeight },
});
writeFileSync(sheetsJsonPath, safeJsonCompact(sheet));
