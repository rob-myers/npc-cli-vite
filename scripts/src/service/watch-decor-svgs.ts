import fs from "node:fs";
import path from "node:path";
import { type DecorManifest, DecorManifestEntrySchema, DecorManifestSchema } from "@npc-cli/ui__map-edit/map-node-api";
import { info, safeJsonCompact, warn } from "@npc-cli/util/legacy/generic";
import { Parser } from "htmlparser2";
import { Canvas, loadImage } from "skia-canvas";
import type { ViteDevServer } from "vite";
import z from "zod";
import { PROJECT_ROOT } from "../const.ts";

// ⚠️ vite didn't watch files outside packages/app, despite vite.config fs server.allow config
// DECOR_PUBLIC_DIR is actually a symlink to packages/media/src/decor
const DECOR_PUBLIC_DIR = path.join(PROJECT_ROOT, "packages/app/public/decor");
const MANIFEST_PATH = path.join(DECOR_PUBLIC_DIR, "manifest.json");

const THUMBNAIL_SIZE = 128;

export function watchDecorSvgs(server: ViteDevServer) {
  fs.mkdirSync(DECOR_PUBLIC_DIR, { recursive: true });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const rebuild = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      rebuildDecor();
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

async function rebuildDecor() {
  const svgFiles = fs.globSync(path.join(DECOR_PUBLIC_DIR, "*.svg"));
  const byKey: DecorManifest["byKey"] = {};

  for (const filePath of svgFiles) {
    const filename = path.basename(filePath);
    const key = path.basename(filename, ".svg");
    const content = fs.readFileSync(filePath, "utf-8");
    const dims = parseSvgDimensions(content, filename);
    if (!dims) continue;

    byKey[key] = DecorManifestEntrySchema.parse({
      key,
      filename,
      width: dims.width,
      height: dims.height,
    });

    await generateThumbnail(key, filePath);
  }

  const nextManifest: DecorManifest = { modifiedAt: new Date().toISOString(), byKey };
  const nextRaw = safeJsonCompact(z.encode(DecorManifestSchema, nextManifest));

  const prevRaw = await fs.promises.readFile(MANIFEST_PATH, "utf-8").catch(() => null);
  if (prevRaw === nextRaw) {
    info(`[watch-decor] manifest.json: no changes detected`);
    return;
  }

  fs.writeFileSync(MANIFEST_PATH, nextRaw);
  info(`[watch-decor] rebuilt manifest.json`);
}

function parseSvgDimensions(svgContent: string, filename: string): { width: number; height: number } | null {
  const meta = { width: 0, height: 0, depth: 0 };
  const viewBoxRegex = /^0 0 (\d+) (\d+)$/;

  const parser = new Parser({
    onopentag(name, attrs) {
      if (name === "svg" && meta.depth === 0) {
        const viewBox = attrs.viewBox || attrs.viewbox || "";
        const matched = viewBox.match(viewBoxRegex);
        if (matched) {
          meta.width = parseInt(matched[1], 10) || 0;
          meta.height = parseInt(matched[2], 10) || 0;
        } else {
          warn(
            `[watch-decor] SVG ${filename} expected viewBox format: "0 0 {w} {h}". Falling back to svg.{width,height}.`,
          );
          meta.width = parseInt(attrs.width, 10) || 0;
          meta.height = parseInt(attrs.height, 10) || 0;
        }
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
    warn(`[watch-decor] SVG ${filename} is missing valid width or height. Skipping.`);
    return null;
  }
  return { width: meta.width, height: meta.height };
}

async function generateThumbnail(key: string, svgPath: string) {
  const pngPath = path.join(DECOR_PUBLIC_DIR, `${key}.thumbnail.png`);
  try {
    const image = await loadImage(svgPath);
    const canvas = new Canvas(THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    const ct = canvas.getContext("2d");

    const scale = Math.min(THUMBNAIL_SIZE / image.width, THUMBNAIL_SIZE / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    ct.drawImage(image, (THUMBNAIL_SIZE - w) / 2, (THUMBNAIL_SIZE - h) / 2, w, h);

    await canvas.toFile(pngPath);
  } catch (e) {
    warn(`[watch-decor] failed to generate thumbnail for ${key}:`, e);
  }
}
