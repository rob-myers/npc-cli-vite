#!/usr/bin/env node --import=tsx

/**
 * - Ensure starship symbol PNGs exist in packages/app/public/starship-symbol
 * - Compute packages/app/public/starship-symbol/metadata.json
 *
 * Usage:
 * pnpm ensure-asset-pngs
 */

import fs, { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type StarshipSymbolPngsMetadata, symbolByGroup } from "@npc-cli/media/starship-symbol";
import { entries, error, keys, safeJsonCompact } from "@npc-cli/util/legacy/generic";
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
// - Generate metadata.json with dimensions of each image
const metadata: StarshipSymbolPngsMetadata = {
  createdAt: new Date().toISOString(),
  byKey: {} as StarshipSymbolPngsMetadata["byKey"],
};

for (const [folderName, symbols] of entries(symbolByGroup)) {
  const mediaSubFolderPath = path.join(mediaOutputDir, folderName);

  for (const symbolKey of keys(symbols)) {
    const srcPath = path.join(mediaSubFolderPath, `${symbolKey}.png`);
    const dstPath = path.join(assetsOutputDir, `${symbolKey}.png`);
    fs.copyFileSync(srcPath, dstPath);

    const dimensions = await imageSizeFromFile(dstPath);
    metadata.byKey[symbolKey] = {
      group: folderName,
      width: dimensions.width,
      height: dimensions.height,
    };
  }
}

writeFileSync(path.join(assetsOutputDir, "metadata.json"), safeJsonCompact(metadata));
