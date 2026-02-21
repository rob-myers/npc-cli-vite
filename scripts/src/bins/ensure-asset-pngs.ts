#!/usr/bin/env node --import=tsx

/**
 * Usage:
 * pnpm ensure-asset-pngs
 */
import fs, { mkdirSync } from "node:fs";
import path from "node:path";
import { symbolByGroup } from "@npc-cli/media/starship-symbols";
import { error } from "@npc-cli/util/legacy/generic";
import { PROJECT_ROOT } from "../const";

const mediaOutputDir = path.join(PROJECT_ROOT, "packages/media/src/starship-symbols/output");
const assetsOutputDir = path.join(PROJECT_ROOT, "packages/app/public/starship-symbols");
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

mkdirSync(assetsOutputDir, { recursive: true });

for (const [folderName, symbols] of Object.entries(symbolByGroup)) {
  const mediaSubFolderPath = path.join(mediaOutputDir, folderName);

  for (const symbolKey of Object.keys(symbols)) {
    const srcPath = path.join(mediaSubFolderPath, `${symbolKey}.png`);
    const dstPath = path.join(assetsOutputDir, `${symbolKey}.png`);
    fs.copyFileSync(srcPath, dstPath);
  }
}
