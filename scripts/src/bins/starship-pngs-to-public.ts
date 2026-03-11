#!/usr/bin/env node --import=tsx

/**
 * - Ensure starship symbol PNGs listed in `symbolByGroup` exist
 *   in packages/app/public/starship-symbol
 * - Compute packages/app/public/starship-symbol/manifest.json
 *
 * Usage:
 * ```sh
 * pnpm starship-pngs-to-public
 * ```
 */

import fs, { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type StarshipSymbolPngsManifest,
  StarshipSymbolPngsManifestSchema,
  symbolByGroup,
} from "@npc-cli/media/starship-symbol";
import { jsonParser } from "@npc-cli/util/json-parser";
import { entries, error, info, keys, safeJsonCompact, warn } from "@npc-cli/util/legacy/generic";
import { imageSizeFromFile } from "image-size/fromFile";
import { PROJECT_ROOT } from "../const";

const mediaOutputDir = path.join(PROJECT_ROOT, "packages/media/src/starship-symbol/output");
const assetsOutputDir = path.join(PROJECT_ROOT, "packages/app/public/starship-symbol");
const seen = new Set<string>();

// Verify each {folder}/{file} exists
for (const [folderName, symbols] of Object.entries(symbolByGroup)) {
  const mediaSubFolderPath = path.join(mediaOutputDir, folderName);

  if (!fs.existsSync(mediaSubFolderPath)) {
    error(`Missing folder: ${mediaSubFolderPath}`);
    process.exit(1);
  }

  for (const symbolKey of Object.keys(symbols)) {
    const filePath = path.join(mediaSubFolderPath, `${symbolKey}.png`);
    if (!fs.existsSync(filePath)) {
      error(`Missing file: ${filePath}`);
      process.exit(1);
    }
    if (seen.has(symbolKey)) {
      error(`Duplicate symbol key: ${symbolKey}`);
      process.exit(1);
    }
    seen.add(symbolKey);
  }
}

// - Copy each {folder}/{file} to public/starship-symbol/{file}
mkdirSync(assetsOutputDir, { recursive: true });

// - Generate manifest.json with dimensions of each image
const byKey = {} as StarshipSymbolPngsManifest["byKey"];

for (const [folderName, symbols] of entries(symbolByGroup)) {
  const mediaSubFolderPath = path.join(mediaOutputDir, folderName);

  for (const symbolKey of keys(symbols)) {
    const srcPath = path.join(mediaSubFolderPath, `${symbolKey}.png`);
    const dstPath = path.join(assetsOutputDir, `${symbolKey}.png`);
    fs.copyFileSync(srcPath, dstPath);

    const dimensions = await imageSizeFromFile(dstPath);
    byKey[symbolKey] = {
      group: folderName,
      width: dimensions.width,
      height: dimensions.height,
    };
  }
}

const prevManifest = jsonParser
  .pipe(StarshipSymbolPngsManifestSchema)
  .safeParse(await fs.promises.readFile(path.join(assetsOutputDir, "manifest.json"), "utf-8").catch(warn)).data;

if (JSON.stringify(prevManifest?.byKey) === JSON.stringify(byKey)) {
  info(`${path.basename(import.meta.filename)}: no changes detected`);
  process.exit(0);
}

info(`${path.basename(import.meta.filename)}: changes detected`);
const nextManifest: StarshipSymbolPngsManifest = { modifiedAt: new Date().toISOString(), byKey };
writeFileSync(path.join(assetsOutputDir, "manifest.json"), safeJsonCompact(nextManifest));
