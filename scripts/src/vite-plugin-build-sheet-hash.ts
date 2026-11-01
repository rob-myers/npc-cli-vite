import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * Writes a content hash per `sheet/*.png` into the built `sheets.json`, as `hash`.
 * A loader puts it in the png's url, so no cache pairs a png with another `sheets.json`.
 */
export function buildSheetHashPlugin(): Plugin {
  let outDir = "";
  return {
    name: "build-sheet-hash",
    apply: "build",

    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },

    closeBundle() {
      const sheetsJsonPath = path.join(outDir, "sheets.json");
      const sheetDir = path.join(outDir, "sheet");
      if (!fs.existsSync(sheetsJsonPath) || !fs.existsSync(sheetDir)) return;

      const hash = Object.fromEntries(
        fs
          .readdirSync(sheetDir)
          .filter((filename) => filename.endsWith(".png"))
          .sort()
          .map((filename) => [
            filename,
            createHash("sha1")
              .update(fs.readFileSync(path.join(sheetDir, filename)))
              .digest("hex")
              .slice(0, 10),
          ]),
      );
      const sheets = JSON.parse(fs.readFileSync(sheetsJsonPath, "utf-8"));
      fs.writeFileSync(sheetsJsonPath, JSON.stringify({ ...sheets, hash }));
      console.log(`[build-sheet-hash] hashed ${Object.keys(hash).length} sheet pngs`);
    },
  };
}
