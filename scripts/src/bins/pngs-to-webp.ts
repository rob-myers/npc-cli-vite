#!/usr/bin/env node --import=tsx

/**
 * Usage
 * - pnpm pngs-to-webp packages/media/src/starship-symbol/output/symbol-machinery
 * - pnpm pngs-to-webp --quality=50 packages/media/src/starship-symbol/output/symbol-machinery
 *
 * Path to directory is relative to repo root.
 *
 * Depends on `cwebp`.
 */

import childProcess from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { error } from "@npc-cli/util/legacy/generic";
import { PROJECT_ROOT } from "../const";

const opts = parseArgs({
  allowPositionals: true,
  options: { quality: { type: "string" } },
  args: process.argv.slice(2),
});

const repoDirPath = opts.positionals[0];
const quality = Number(opts.values.quality || 75);

const dirPath = path.resolve(PROJECT_ROOT, repoDirPath as string);
const filePaths = childProcess
  .execSync(`find "${dirPath}" -type f -name "*.png"`)
  .toString()
  .split("\n")
  .filter(Boolean);

try {
  childProcess.execSync(`
    echo '${filePaths.map((absPath) => `"${absPath}"`).join("\n")}' |
      xargs -L 1 -I {} -n 1 -P 3 cwebp -q ${quality} -noasm ${"-quiet"} "{}" -o "{}".webp
  `);
} catch (_err) {
  error("Error converting PNGs to WebP");
  for (const filePath of filePaths) {
    const webpPath = `${filePath}.webp`;
    if (!existsSync(webpPath) || statSync(webpPath).size === 0) {
      error(`Failed to convert ${filePath}`);
    }
  }
}
