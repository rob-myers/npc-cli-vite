#!/usr/bin/env node --import=tsx

/**
 * Usage:
 * pnpm ensure-asset-pngs
 */
import fs from "node:fs";
import path from "node:path";
import { symbolByGroup } from "@npc-cli/media/starship-symbols";
import { error } from "@npc-cli/util/legacy/generic";
import { PROJECT_ROOT } from "../const";

const outputDir = path.join(PROJECT_ROOT, "packages/media/src/starship-symbols/output");

for (const [folderName, symbols] of Object.entries(symbolByGroup)) {
  const folderPath = path.join(outputDir, folderName);

  if (!fs.existsSync(folderPath)) {
    error(`Missing folder: ${folderPath}`);
    process.exit(1);
  }

  for (const symbolKey of Object.keys(symbols)) {
    const filePath = path.join(folderPath, `${symbolKey}.png`);
    if (!fs.existsSync(filePath)) {
      error(`Missing file: ${filePath}`);
      process.exit(1);
    }
  }
}
