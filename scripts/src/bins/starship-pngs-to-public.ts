#!/usr/bin/env node --import=tsx

/**
 * - Copy starship symbol PNGs:
 *   - referenced by `symbolByGroup`
 *   - from:
 *     - packages/media/src/starship-symbol/output
 *     - packages/media/src/starship-symbol/extra
 *     - packages/media/src/starship-symbol/playground
 *   - to: packages/app/public/starship-symbol
 *
 * - Also compute packages/app/public/starship-symbol/manifest.json
 *
 * Usage:
 * ```sh
 * pnpm starship-pngs-to-public
 * ```
 */

import fs, { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type StarshipSymbolPngsManifest, symbolByGroup } from "@npc-cli/media/starship-symbol";
import { entries, error, info, keys, safeJsonCompact, warn } from "@npc-cli/util/legacy/generic";
import { imageSizeFromFile } from "image-size/fromFile";
import { PROJECT_ROOT } from "../const";

const mediaOutputDir = path.join(PROJECT_ROOT, "packages/media/src/starship-symbol/output");
/** Extra symbols not directly obtained from Eric Smith's decomposition */
const mediaExtraDir = path.join(PROJECT_ROOT, "packages/media/src/starship-symbol/extra");
/** Playground symbols are extra symbols which may be edited */
const mediaPlaygroundDir = path.join(PROJECT_ROOT, "packages/media/src/starship-symbol/playground");

const assetsOutputDir = path.join(PROJECT_ROOT, "packages/app/public/starship-symbol");
const seen = new Set<string>();

/**
 * - original symbols from `output/{group}/{symbol_key}.png`
 * - extra-- prefixed from `extra/extra--foo.png`
 * - --playground suffixed come from `playground/foo--playground.png`
 */
function getSymbolParentDirectory(folderName: string) {
  return folderName === "extra"
    ? mediaExtraDir
    : folderName === "playground"
      ? mediaPlaygroundDir
      : path.join(mediaOutputDir, folderName);
}

// Verify each {folder}/{file} exists
for (const [folderName, symbols] of Object.entries(symbolByGroup)) {
  const mediaSubFolderPath = getSymbolParentDirectory(folderName);

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
// - may assume no filename collisions
mkdirSync(assetsOutputDir, { recursive: true });

// Generate manifest.json with dimensions of each image
const byKey = {} as StarshipSymbolPngsManifest["byKey"];

for (const [folderName, symbols] of entries(symbolByGroup)) {
  const mediaSubFolderPath = getSymbolParentDirectory(folderName);

  for (const symbolKey of keys(symbols)) {
    const srcPath = path.join(mediaSubFolderPath, `${symbolKey}.png`);
    const dstPath = path.join(assetsOutputDir, `${symbolKey}.png`);
    fs.copyFileSync(srcPath, dstPath);

    const dimensions = await imageSizeFromFile(dstPath);
    byKey[symbolKey] = {
      key: symbolKey,
      group: folderName,
      width: dimensions.width,
      height: dimensions.height,
    };
  }
}

const prevManifestRaw = await fs.promises.readFile(path.join(assetsOutputDir, "manifest.json"), "utf-8").catch(warn);
const nextManifestRaw = safeJsonCompact({ byKey } satisfies StarshipSymbolPngsManifest);

if (prevManifestRaw === nextManifestRaw) {
  info(`${path.basename(import.meta.filename)}: no changes detected`);
  process.exit(0);
}

info(`${path.basename(import.meta.filename)}: changes detected`);
writeFileSync(path.join(assetsOutputDir, "manifest.json"), nextManifestRaw);
