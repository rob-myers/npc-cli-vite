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
  }
}

mkdirSync(assetsOutputDir, { recursive: true });

for (const [folderName, symbols] of Object.entries(symbolByGroup)) {
  const mediaSubFolderPath = path.join(mediaOutputDir, folderName);
  const assetsSubFolderPath = path.join(assetsOutputDir, folderName);
  mkdirSync(assetsSubFolderPath, { recursive: true });

  for (const symbolKey of Object.keys(symbols)) {
    const srcPath = path.join(mediaSubFolderPath, `${symbolKey}.png`);
    const dstPath = path.join(assetsSubFolderPath, `${symbolKey}.png`);
    fs.copyFileSync(srcPath, dstPath);
  }
}
