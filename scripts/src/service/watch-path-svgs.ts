import fs from "node:fs";
import path from "node:path";
import { type PathManifest, PathManifestEntrySchema, PathManifestSchema } from "@npc-cli/ui__map-edit/editor.schema";
import { devMessageFromServer } from "@npc-cli/ui__map-edit/map-node-api";
import { jsonParser } from "@npc-cli/util/json-parser";
import { info, warn } from "@npc-cli/util/legacy/generic";
import { Parser } from "htmlparser2";
import type { ViteDevServer } from "vite";
import { PROJECT_ROOT } from "../const.ts";

const PUBLIC_DIR = path.join(PROJECT_ROOT, "packages/app/public");
const PATH_DIR = path.join(PUBLIC_DIR, "path");

export function watchPathSvgs(server: ViteDevServer) {
  const manifestPath = path.join(PATH_DIR, "manifest.json");
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const rebuild = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      rebuildPathManifest(manifestPath, server);
    }, 200);
  };

  server.watcher.add(path.join(PATH_DIR, "*.svg"));
  server.watcher.on("add", (filePath) => isPathSvg(filePath) && rebuild());
  server.watcher.on("change", (filePath) => isPathSvg(filePath) && rebuild());
  server.watcher.on("unlink", (filePath) => isPathSvg(filePath) && rebuild());

  // initial build (no notification needed)
  rebuildPathManifest(manifestPath, null);
}

function isPathSvg(filePath: string) {
  return filePath.startsWith(PATH_DIR) && filePath.endsWith(".svg");
}

async function rebuildPathManifest(manifestPath: string, server: ViteDevServer | null) {
  const svgFiles = fs.globSync(path.join(PATH_DIR, "*.svg"));
  const byKey: PathManifest["byKey"] = {};

  for (const filePath of svgFiles) {
    const filename = path.basename(filePath);
    const key = path.basename(filename, ".svg");
    const content = fs.readFileSync(filePath, "utf-8");
    const entry = parseSvgForManifest(content, filename, key);
    // must re-parse to ensure key-ordering
    if (entry) byKey[key] = PathManifestEntrySchema.parse(entry);
  }

  const prevManifest = jsonParser
    .pipe(PathManifestSchema)
    .safeParse(await fs.promises.readFile(manifestPath, "utf-8").catch(warn)).data;

  if (JSON.stringify(prevManifest?.byKey) === JSON.stringify(byKey)) {
    info(`[map-edit-api] path/manifest.json: no changes detected`);
    return;
  }

  const nextManifest: PathManifest = { modifiedAt: new Date().toISOString(), byKey };
  fs.writeFileSync(manifestPath, JSON.stringify(nextManifest, null, 2));
  info(`[map-edit-api] rebuilt path/manifest.json`);
  server?.hot.send({ type: "custom", event: devMessageFromServer.recomputedPathManifest });
}

function parseSvgForManifest(
  svgContent: string,
  filename: string,
  key: string,
): { filename: string; key: string; pathCount: number; width: number; height: number } | null {
  const meta = { width: 0, height: 0, pathCount: 0, depth: 0 };
  const viewBoxRegex = /^0 0 (\d+) (\d+)$/;

  const parser = new Parser({
    onopentag(name, attrs) {
      if (name === "svg" && meta.depth === 0) {
        // expect viewBox `0 0 {w} {h}`
        const viewBox = attrs.viewBox || attrs.viewbox || ""; // ⚠️ parser forces lowercase "viewbox"
        const matched = viewBox.match(viewBoxRegex);
        if (matched) {
          meta.width = parseInt(matched[1], 10) || 0;
          meta.height = parseInt(matched[2], 10) || 0;
        } else {
          warn(
            `[map-edit-api] SVG ${filename} expected viewBox format: "0 0 {w} {h}". Falling back to svg.{width,height}.`,
          );
          meta.width = parseInt(attrs.width, 10) || 0;
          meta.height = parseInt(attrs.height, 10) || 0;
        }
      }
      if (name === "path" && meta.depth === 1) {
        meta.pathCount++;
      }
      meta.depth++;
    },
    onclosetag() {
      meta.depth--;
    },
  });

  parser.write(svgContent);
  parser.end();

  if (meta.width === 0 || meta.height === 0) {
    warn(`[map-edit-api] SVG ${filename} is missing valid width or height attributes. Skipping.`);
    return null;
  }
  return { filename, key, pathCount: meta.pathCount, width: meta.width, height: meta.height };
}
