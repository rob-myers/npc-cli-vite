#!/usr/bin/env node

/**
 * creates/mutates
 * - public/sheets.json (decor fields)
 * creates
 * - public/sheet/decor.{sheetId}.png
 *
 * Usage
 * ```sh
 * pnpm exec gen-decor-sheets
 * ```
 *
 * dependencies
 * - `public/decor/manifest.json` (rebuilt by this script)
 * - `public/decor/*.thumbnail.png` (rebuilt by this script)
 * - `pngquant` command to reduce PNG size
 */

import fs, { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DecorManifestSchema } from "@npc-cli/ui__map-edit/editor.schema";
import { type DecorSheetEntry, emptySheets, SheetsSchema } from "@npc-cli/ui__world/assets.schema";
import { Rect } from "@npc-cli/util/geom/rect";
import { jsonParser } from "@npc-cli/util/json-parser";
import { safeJsonCompact, warn } from "@npc-cli/util/legacy/generic";
import { Canvas, loadImage } from "skia-canvas";
import z from "zod";
import { packRectangles } from "../../../scripts/src/service/rects-packer.ts";
import { PROJECT_ROOT } from "../const.ts";
import { loggedSpawn } from "../service/logged-spawn.ts";
import { rebuildDecor } from "../service/watch-decor-svgs.ts";

const decorSheetCellSize = 256;

// 1. rebuild thumbnails and manifest
await rebuildDecor();

// 2. read manifest
const decorDir = path.resolve(PROJECT_ROOT, "packages/app/public/decor");
const manifestRaw = fs.readFileSync(path.join(decorDir, "manifest.json"), "utf-8");
const manifest = jsonParser.pipe(DecorManifestSchema).parse(manifestRaw);
const entries = Object.values(manifest.byKey);

if (entries.length === 0) {
  console.log("gen-decor-sheets: no decor entries found");
  process.exit(0);
}

// 3. pack thumbnails (all 128×128)
const {
  bins,
  width: maxWidth,
  height: maxHeight,
} = packRectangles<{ key: string; originalWidth: number; originalHeight: number }>(
  entries.map(({ key, width: originalWidth, height: originalHeight }) => ({
    width: decorSheetCellSize,
    height: decorSheetCellSize,
    data: { key, originalWidth, originalHeight },
  })),
  {
    logPrefix: "gen-decor-sheets",
    packedPadding: 2,
    maxWidth: 4096,
    maxHeight: 4096,
  },
);

// 4. update sheets.json
const sheetsJsonPath = path.resolve(PROJECT_ROOT, "packages/app/public", "sheets.json");
const prevSheetsRaw = await fs.promises.readFile(sheetsJsonPath, "utf-8").catch(warn);
const prevSheets = jsonParser
  .pipe(SheetsSchema.extend({ decor: z.unknown().optional() }))
  .safeParse(prevSheetsRaw).data ?? emptySheets;

const sheet = SheetsSchema.encode({
  ...prevSheets,
  decor: Object.fromEntries(
    bins.flatMap((bin, sheetId) =>
      bin.rects.map<[string, DecorSheetEntry]>(({ x, y, width, height, data }) => [
        data.key,
        {
          key: data.key,
          rect: Rect.fromJson({ x, y, width, height }),
          sheetId,
          originalWidth: data.originalWidth,
          originalHeight: data.originalHeight,
        },
      ]),
    ),
  ),
  decorSheetDims: bins.map((bin) => ({ width: bin.width, height: bin.height })),
  maxDecorSheetDim: { width: maxWidth, height: maxHeight },
});
writeFileSync(sheetsJsonPath, safeJsonCompact(sheet));

// 5. generate sheet PNGs
const sheetDir = path.resolve(PROJECT_ROOT, "packages/app/public/sheet");
mkdirSync(sheetDir, { recursive: true });

for (const [sheetId, bin] of bins.entries()) {
  const canvas = new Canvas(bin.width, bin.height);
  const ct = canvas.getContext("2d");

  for (const rect of bin.rects) {
    const svgPath = path.join(decorDir, `${rect.data.key}.svg`);
    const image = await loadImage(svgPath);
    const scale = Math.min(rect.width / image.width, rect.height / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    ct.drawImage(image, rect.x + (rect.width - w) / 2, rect.y + (rect.height - h) / 2, w, h);
  }

  await canvas.toFile(path.resolve(sheetDir, `decor.${sheetId}.png`));
}

// 6. reduce PNG size (decor sheets only)
process.chdir(sheetDir);
await loggedSpawn({
  label: "pngquant",
  command: "pngquant",
  args: ["--force", "--ext", ".png", "decor.*.png"],
  shell: true,
});
