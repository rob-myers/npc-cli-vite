import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { type DecorManifest, DecorManifestEntrySchema, DecorManifestSchema } from "@npc-cli/ui__map-edit/editor.schema";
import { devMessageFromServer } from "@npc-cli/ui__map-edit/map-node-api";
import { info, safeJsonCompact, tagsToMeta, textToTags, warn } from "@npc-cli/util/legacy/generic";
import { Parser } from "htmlparser2";
import { Canvas, loadImage } from "skia-canvas";
import type { ViteDevServer } from "vite";
import z from "zod";
import { PROJECT_ROOT } from "../const.ts";

// ⚠️ vite didn't watch files outside packages/app, despite vite.config fs server.allow config
// DECOR_PUBLIC_DIR is actually a symlink to packages/media/src/decor
const DECOR_PUBLIC_DIR = path.join(PROJECT_ROOT, "packages/app/public/decor");
const DECOR_MANIFEST_PATH = path.join(DECOR_PUBLIC_DIR, "manifest.json");

// Default resolution is 60sgu ~ 1.5m ~ 256 pixels
// Can change via top-level attribute e.g. `px-per-tile=512` in SVG
const PIXELS_PER_SGU_TILE = 256;

export function watchDecorSvgs(server: ViteDevServer) {
  fs.mkdirSync(DECOR_PUBLIC_DIR, { recursive: true });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const rebuild = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      try {
        execSync("pnpm exec gen-decor-sheets", { cwd: PROJECT_ROOT, stdio: "inherit" });
        server.hot.send({ type: "custom", event: devMessageFromServer.decorSheetsRebuilt });
      } catch (e) {
        warn("[watch-decor] gen-decor-sheets failed:", e);
      }
    }, 200);
  };

  server.watcher.add(path.join(DECOR_PUBLIC_DIR, "*.svg"));
  server.watcher.on("add", (filePath) => isDecorSvg(filePath) && rebuild());
  server.watcher.on("change", (filePath) => isDecorSvg(filePath) && rebuild());
  server.watcher.on("unlink", (filePath) => {
    if (!isDecorSvg(filePath)) return;
    const key = path.basename(filePath, ".svg");
    fs.promises.unlink(path.join(DECOR_PUBLIC_DIR, `${key}.thumbnail.png`)).catch(() => {});
    fs.promises.unlink(path.join(DECOR_PUBLIC_DIR, `${key}.svg`)).catch(() => {});
    rebuild();
  });

  // initial build (no notification needed)
  rebuildDecor();
}

function isDecorSvg(filePath: string) {
  return filePath.startsWith(DECOR_PUBLIC_DIR) && filePath.endsWith(".svg");
}

export async function rebuildDecor() {
  const svgFiles = fs.globSync(path.join(DECOR_PUBLIC_DIR, "*.svg"));
  const byKey: DecorManifest["byKey"] = {};

  for (const filePath of svgFiles) {
    const filename = path.basename(filePath);
    const key = path.basename(filename, ".svg");
    const content = fs.readFileSync(filePath, "utf-8");
    const dims = parseSvgDimensions(content, filename);
    if (!dims) continue;

    byKey[key] = DecorManifestEntrySchema.encode({
      key,
      filename,
      ...dims, // width, height, outputWidth, outputHeight
    });

    await generateThumbnail(key, filePath, dims.outputWidth, dims.outputHeight);
  }

  const nextManifest: DecorManifest = { byKey };
  const nextRaw = safeJsonCompact(z.encode(DecorManifestSchema, nextManifest));

  const prevRaw = await fs.promises.readFile(DECOR_MANIFEST_PATH, "utf-8").catch(() => null);
  if (prevRaw === nextRaw) {
    info(`[watch-decor] manifest.json: no changes detected`);
    return;
  }

  fs.writeFileSync(DECOR_MANIFEST_PATH, nextRaw);
  info(`[watch-decor] rebuilt manifest.json`);
}

/** width, height overrides viewBox */
function parseSvgDimensions(
  svgContent: string,
  filename: string,
): { width: number; height: number; outputWidth: number; outputHeight: number } | null {
  const meta = { width: 0, height: 0, depth: 0, tag: "", pxPerTile: PIXELS_PER_SGU_TILE };
  const viewBoxRegex = /^0 0 (\d+) (\d+)$/;

  const parser = new Parser({
    onopentag(name, attrs) {
      if (name === "svg" && meta.depth === 0) {
        const viewBox = attrs.viewBox || attrs.viewbox || "";

        // svg {width,height} take precedence over viewBox
        meta.width = parseInt(attrs.width, 10) || 0;
        meta.height = parseInt(attrs.height, 10) || 0;

        if (meta.width === 0 || meta.height === 0) {
          const matched = viewBox.match(viewBoxRegex);
          if (matched) {
            meta.width = parseInt(matched[1], 10) || 0;
            meta.height = parseInt(matched[2], 10) || 0;
          } else {
            warn(`[watch-decor] SVG ${filename} lacks valid width, height, viewBox.`);
          }
        }
      }

      meta.tag = name;
      meta.depth++;
    },
    ontext(text) {
      if (meta.depth - 1 === 2 && meta.tag === "title") {
        // support custom px-per-tile
        const parsedMeta = tagsToMeta(textToTags(text));
        if (typeof parsedMeta["px-per-tile"] === "number") {
          meta.pxPerTile = parsedMeta["px-per-tile"];
        }
      }
    },
    onclosetag() {
      meta.depth--;
    },
  });

  parser.write(svgContent);
  parser.end();

  if (meta.width === 0 || meta.height === 0) {
    warn(`[watch-decor] SVG ${filename} is missing valid width or height. Skipping.`);
    return null;
  }

  return {
    width: meta.width,
    height: meta.height,
    outputWidth: Math.ceil(meta.width * (meta.pxPerTile / 60)),
    outputHeight: Math.ceil(meta.height * (meta.pxPerTile / 60)),
  };
}

async function generateThumbnail(key: string, svgPath: string, widthPixels: number, heightPixels: number) {
  const pngPath = path.join(DECOR_PUBLIC_DIR, `${key}.thumbnail.png`);
  try {
    const image = await loadImage(svgPath);
    const canvas = new Canvas(widthPixels, heightPixels);
    const ct = canvas.getContext("2d");
    ct.drawImage(image, 0, 0, canvas.width, canvas.height);
    await canvas.toFile(pngPath);
  } catch (e) {
    warn(`[watch-decor] failed to generate thumbnail for ${key}:`, e);
  }
}
