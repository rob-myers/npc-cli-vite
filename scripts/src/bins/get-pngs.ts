import { error, info, warn } from "@npc-cli/util/legacy/generic";
import childProcess from "child_process";
import fs from "fs";
import stringify from "json-stringify-pretty-compact";
import path from "path";
import {
  altSymbolsFilenameRegex,
  geomorphsFilenameRegex,
  metaFromAltSymbolFilename,
  metaFromGeomorphFilename,
  metaFromRootFilename,
  metaFromSmallCraftFilename,
  metaFromSymbolFilename,
  rootFilenameRegex,
  smallCraftFilenameRegex,
  symbolsFilenameRegex,
  type FileMeta,
} from "../starship-symbols/service";

/**
 * Rename & trim PNGs
 * - Starship Symbols 2.0 by Robert Pearce https://travellerrpgblog.blogspot.com/
 * - Source PNGs extracted by Eric B. Smith http://gurpsland.no-ip.org/geomorphs/
 *
 * Usage:
 * ```sh
 * # {input_type} in ['root', 'geomorph', 'symbol', 'small-craft']
 * # {src_folder} relative to {repo_root}/media
 * # {src_folder} exists
 * # {dst_folder} relative to {repo_root}/media/extracted
 * yarn get-pngs {input_type} {src_folder} {dst_folder}
 * yarn get-pngs-fast {input_type} {src_folder} {dst_folder}
 * ```
 *
 * Examples:
 * ```sh
 * yarn get-pngs-fast root Symbols symbol-root
 * yarn get-pngs-fast geomorph 'Geomorphs/100x50 Edge' geomorph-edge
 * yarn get-pngs-fast geomorph 'Geomorphs/100x100 Core' geomorph-core
 * yarn get-pngs-fast symbol Symbols/Bridge symbol-bridge
 * yarn get-pngs-fast small-craft 'Small Craft' symbol-small-craft
 *
 * yarn get-pngs-fast symbol 'Symbols/Furniture, Consoles, & Equipment' symbol-furniture-consoles-equipment
 * yarn get-pngs-fast symbol 'Symbols/Machinery' symbol-machinery
 * yarn get-pngs-fast symbol 'Symbols/Lab' symbol-lab
 * yarn get-pngs-fast symbol 'Symbols/Battery' symbol-battery
 * yarn get-pngs-fast symbol 'Symbols/Medical' symbol-medical
 * yarn get-pngs-fast symbol 'Symbols/Misc' symbol-misc
 * yarn get-pngs-fast symbol 'Symbols/Offices' symbol-offices
 * yarn get-pngs-fast symbol 'Symbols/Shop & Repair Area' symbol-shop-repair-area
 * yarn get-pngs-fast symbol Symbols/Fresher symbol-fresher
 * yarn get-pngs-fast symbol 'Symbols/Galley & Mess' symbol-galley-and-mess
 * ```
 */
const [, , inputType, srcFolder, dstFolder] = process.argv;
const mediaDir = path.resolve(__dirname, "../media");
const srcDir = path.resolve(mediaDir, srcFolder);
const dstDir = path.resolve(mediaDir, "extracted", dstFolder);
const manifestPath = path.join(dstDir, "manifest.json");

if (
  !(
    inputType === "root" ||
    inputType === "geomorph" ||
    inputType === "symbol" ||
    inputType === "small-craft"
  ) ||
  !srcFolder ||
  !fs.existsSync(srcDir) ||
  !fs.statSync(srcDir).isDirectory() ||
  !dstFolder
) {
  error(`error: usage: yarn get-pngs {input_type} {src_folder} {dst_folder} where:
  - {input_type} in ['root', 'geomorph', 'symbol', 'small-craft']
  - {src_folder} relative to {repo_root}/media
  - {src_folder} exists
  - {dst_folder} relative to {repo_root}/media/extracted
  `);
  process.exit(1);
}

(async function main() {
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
    info(`applying ImageMagick \`convert\` to ${dstName}`);
    childProcess.execSync(`
      convert -fuzz 1% -trim "${dstPath}" "${dstPath}.tmp.png"
      mv "${dstPath}.tmp.png" "${dstPath}"
    `);
  }
})();

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
