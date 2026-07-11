#!/usr/bin/env node

/**
 * creates/mutates
 * - public/sheets.json (skin fields)
 * creates
 * - public/sheet/skin.{sheetId}.png
 *
 * Usage
 * ```sh
 * pnpm exec gen-skin-sheets
 * ```
 *
 * dependencies
 * - `public/skin/manifest.json` (rebuilt by this script)
 * - `pngquant` command to reduce PNG size of sheets
 */

import fs, { mkdirSync, writeFileSync } from "node:fs";
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
import { Canvas, loadImage } from "skia-canvas";
import { PROJECT_ROOT } from "../const.ts";
import { loggedSpawn } from "../service/logged-spawn.ts";
import { packRectangles } from "../service/rects-packer.ts";
import { rebuildSkinManifest } from "../service/watch-skin-pngs.ts";

/** Minecraft skins are 64x64 */
const skinSheetCellSize = 64;

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

// 5. generate sheet PNGs
const sheetDir = path.resolve(PROJECT_ROOT, "packages/app/public/sheet");
mkdirSync(sheetDir, { recursive: true });

for (const [sheetId, bin] of bins.entries()) {
  const canvas = new Canvas(bin.width, bin.height);
  const ct = canvas.getContext("2d");

  for (const rect of bin.rects) {
    const skinPngPath = path.join(skinDir, rect.data.filename);
    const image = await loadImage(skinPngPath);
    const scale = Math.min(rect.width / image.width, rect.height / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    ct.drawImage(image, rect.x + (rect.width - w) / 2, rect.y + (rect.height - h) / 2, w, h);
  }

  await canvas.toFile(path.resolve(sheetDir, `skin.${sheetId}.png`));
}

// 6. reduce PNG size of skin sheets
try {
  process.chdir(sheetDir);
  await loggedSpawn({
    label: "pngquant",
    command: "pngquant",
    args: ["--force", "--ext", ".png", "skin.*.png"],
    shell: true,
  });
} catch (e) {
  warn(`pngquant failed to optimize PNGs: have you installed it?`);
  warn(e);
}
