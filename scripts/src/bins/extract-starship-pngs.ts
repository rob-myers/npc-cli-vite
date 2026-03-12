#!/usr/bin/env node --import=tsx

import { error, info, warn } from "@npc-cli/util/legacy/generic";
import childProcess from "child_process";
import fs from "fs";
import stringify from "json-stringify-pretty-compact";
import path from "path";
import { PROJECT_ROOT } from "../const";
import {
  altSymbolsFilenameRegex,
  type FileMeta,
  geomorphsFilenameRegex,
  metaFromAltSymbolFilename,
  metaFromGeomorphFilename,
  metaFromRootFilename,
  metaFromSmallCraftFilename,
  metaFromSymbolFilename,
  rootFilenameRegex,
  smallCraftFilenameRegex,
  symbolsFilenameRegex,
} from "../service/rename-starship-symbols";

/**
 * Rename & trim PNGs
 * - Starship Symbols 2.0 by Robert Pearce https://travellerrpgblog.blogspot.com/
 * - Source PNGs extracted by Eric B. Smith http://gurpsland.no-ip.org/geomorphs/
 *
 * Usage:
 * ```sh
 * # {input_type} in ['root', 'geomorph', 'symbol', 'small-craft']
 * # {src_folder} relative to {repo_root}/packages/media/src/starship-symbol/input
 * # {src_folder} exists
 * # {dst_folder} relative to {repo_root}/packages/media/src/starship-symbol/output
 * pnpm extract-starship-pngs {input_type} {src_folder} {dst_folder}
 * pnpm extract-starship-pngs {input_type} {src_folder} {dst_folder}
 * ```
 *
 * Examples:
 * ```sh
 * pnpm extract-starship-pngs root Symbols symbol-root
 * pnpm extract-starship-pngs symbol 'Symbols/Furniture, Consoles, & Equipment' symbol-furniture-consoles-equipment
 * pnpm extract-starship-pngs symbol 'Symbols/Machinery' symbol-machinery
 * pnpm extract-starship-pngs geomorph 'Geomorphs/100x50 Edge' geomorph-edge
 * pnpm extract-starship-pngs geomorph 'Geomorphs/100x100 Core' geomorph-core
 * pnpm extract-starship-pngs symbol Symbols/Bridge symbol-bridge
 * pnpm extract-starship-pngs small-craft 'Small Craft' symbol-small-craft
 * pnpm extract-starship-pngs symbol 'Symbols/Lab' symbol-lab
 * pnpm extract-starship-pngs symbol 'Symbols/Misc' symbol-misc
 * pnpm extract-starship-pngs symbol 'Symbols/Offices' symbol-office
 * pnpm extract-starship-pngs symbol 'Symbols/Galley & Mess' symbol-galley-and-mess
 * pnpm extract-starship-pngs symbol 'Symbols/Battery' symbol-battery
 * pnpm extract-starship-pngs symbol 'Symbols/Medical' symbol-medical
 * pnpm extract-starship-pngs symbol 'Symbols/Cargo' symbol-cargo
 * pnpm extract-starship-pngs symbol 'Symbols/Empty Room' symbol-empty-room
 * pnpm extract-starship-pngs symbol 'Symbols/Engineering' symbol-engineering
 * pnpm extract-starship-pngs symbol 'Symbols/Fresher' symbol-fresher
 * pnpm extract-starship-pngs symbol 'Symbols/Fuel' symbol-fuel
 * pnpm extract-starship-pngs symbol 'Symbols/Lounge' symbol-lounge
 * pnpm extract-starship-pngs symbol 'Symbols/Low Berth' symbol-low-berth
 * pnpm extract-starship-pngs symbol "Symbols/Ship's Locker" symbol-ships-locker
 * pnpm extract-starship-pngs symbol 'Symbols/Shop & Repair Area' symbol-shop-repair-area
 * pnpm extract-starship-pngs symbol 'Symbols/Staterooms' symbol-stateroom
 * ```
 */

const errorMessage = `error: usage: pnpm extract-starship-pngs {input_type} {src_folder} {dst_folder} where:
  - {input_type} in ['root', 'geomorph', 'symbol', 'small-craft']
  - {src_folder} relative to {repo_root}/packages/media/src/starship-symbol/input
  - {src_folder} exists
  - {dst_folder} relative to {repo_root}/packages/media/src/starship-symbol/output
  `;

const [, , inputType, srcFolder, dstFolder] = process.argv;
const mediaDir = path.resolve(PROJECT_ROOT, "packages/media");
if (!srcFolder || !dstFolder) {
  error(errorMessage);
  process.exit(1);
}
const srcDir = path.resolve(mediaDir, "./src/starship-symbol/input", srcFolder);
const dstDir = path.resolve(mediaDir, "./src/starship-symbol/output", dstFolder);
const manifestPath = path.join(dstDir, "manifest.json");

if (
  !(inputType === "root" || inputType === "geomorph" || inputType === "symbol" || inputType === "small-craft") ||
  !srcFolder ||
  !fs.existsSync(srcDir) ||
  !fs.statSync(srcDir).isDirectory() ||
  !dstFolder
) {
  error(errorMessage);
  console.log({ srcDir, dstDir });
  process.exit(1);
}

const srcFilenames = fs.readdirSync(srcDir);
fs.mkdirSync(dstDir, { recursive: true });

info("creating manifest:", manifestPath);

const fileMetas = computeFileMetas(srcFilenames);
fs.writeFileSync(
  manifestPath,
  stringify({
    parentFolder: path.basename(srcDir),
    sourceType: inputType,
    fileMetas,
  }),
);

if (!fileMetas.length) {
  info("no files found");
  process.exit(0);
}

// saw bad performance with xargs -P 3
for (const { srcName, dstName } of fileMetas) {
  info(`copying ${srcName} to ${dstName}`);
  const [srcPath, dstPath] = [path.join(srcDir, srcName), path.join(dstDir, dstName)];
  childProcess.execSync(`cp -f "${srcPath}" "${dstPath}"`);
  info(`applying ImageMagick \`magick\` to ${dstName}`);
  // - originally worked: `convert -fuzz 1% -trim`
  // - loses 1x1 border in some cases: `magick "${dstPath}" -shave 1x1 -fuzz 1% -trim "${dstPath}.tmp.png"`
  childProcess.execSync(
    `
    test 1 = "$( magick "${dstPath}" -crop x1+0+0 +repage -alpha extract -format "%[fx:maxima == 1 ? 1 : 0]\n" info: )" &&
      {
        echo "🤖 fully opaque pixel detected in top line";
        magick "${dstPath}" "${dstPath}.tmp.png";
      } || {
        echo "🤖 no fully opaque pixel in top line";
        magick "${dstPath}" -shave 1x1 -fuzz 1% -trim "${dstPath}.tmp.png";
      }
    
    mv "${dstPath}.tmp.png" "${dstPath}" ||
      echo "⚠️ ImageMagick failed for ${dstName}"
    `,
    { stdio: "inherit" },
  );
}

function computeFileMetas(srcFilenames: string[]): FileMeta[] {
  const fileMetas: FileMeta[] = [];
  switch (inputType) {
    //Convert those PNGs directly inside `Symbols/`
    case "root":
      srcFilenames.forEach((filename) => {
        const matched = filename.match(rootFilenameRegex);
        if (matched) fileMetas.push(metaFromRootFilename(matched));
        else if (filename.match(/\.png$/)) warn("ignoring PNG:", filename);
      });
      break;
    // Convert some fixed subfolder of `Geomorphs/`, ignoring [Overlay]
    case "geomorph":
      srcFilenames.forEach((filename) => {
        const matched = filename.match(geomorphsFilenameRegex);
        if (matched !== null && !filename.includes(" [Overlay] ")) {
          fileMetas.push(metaFromGeomorphFilename(matched));
        } else if (filename.match(/\.png$/)) warn("ignoring PNG:", filename);
      });
      break;
    // Convert some fixed subfolder of `Symbols/`
    case "symbol":
      srcFilenames.forEach((filename) => {
        let matched = filename.match(symbolsFilenameRegex);
        if (matched) fileMetas.push(metaFromSymbolFilename(matched));
        else {
          matched = filename.match(altSymbolsFilenameRegex);
          if (matched) fileMetas.push(metaFromAltSymbolFilename(matched));
          else if (filename.match(/\.png$/)) warn("ignoring PNG:", filename);
        }
      });
      break;
    // Convert those PNGs directly inside `Small Craft/`
    case "small-craft":
      srcFilenames.forEach((filename) => {
        const matched = filename.match(smallCraftFilenameRegex);
        if (matched) fileMetas.push(metaFromSmallCraftFilename(matched));
        else if (filename.match(/\.png$/)) warn("ignoring PNG:", filename);
      });
      break;
  }
  // 🔔 force ordering
  return fileMetas.sort((a, b) => (a.srcName < b.srcName ? -1 : 1));
}
