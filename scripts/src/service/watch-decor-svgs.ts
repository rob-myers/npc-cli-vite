import fs from "node:fs";
import path from "node:path";
import { info, warn } from "@npc-cli/util/legacy/generic";
import { Canvas, loadImage } from "skia-canvas";
import type { ViteDevServer } from "vite";
import { PROJECT_ROOT } from "../const.ts";

const DECOR_SRC_DIR = path.join(PROJECT_ROOT, "packages/media/src/decor");
const DECOR_PUBLIC_DIR = path.join(PROJECT_ROOT, "packages/app/public/decor");

const THUMBNAIL_SIZE = 128;

export function watchDecorSvgs(server: ViteDevServer) {
  fs.mkdirSync(DECOR_PUBLIC_DIR, { recursive: true });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const rebuild = (filePath: string) => {
    if (!isDecorSvg(filePath)) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      generateThumbnail(path.basename(filePath));
    }, 200);
  };

  server.watcher.add(path.join(DECOR_SRC_DIR, "*.svg"));
  server.watcher.on("add", rebuild);
  server.watcher.on("change", rebuild);
  server.watcher.on("unlink", (filePath) => {
    if (!isDecorSvg(filePath)) return;
    const pngName = path.basename(filePath, ".svg") + ".thumbnail.png";
    const pngPath = path.join(DECOR_PUBLIC_DIR, pngName);
    fs.promises.unlink(pngPath).catch(() => {});
    info(`[watch-decor] removed ${pngName}`);
  });

  // initial build of all
  generateAllThumbnails();
}

function isDecorSvg(filePath: string) {
  return filePath.startsWith(DECOR_SRC_DIR) && filePath.endsWith(".svg");
}

async function generateAllThumbnails() {
  const svgFiles = fs.globSync(path.join(DECOR_SRC_DIR, "*.svg"));
  for (const filePath of svgFiles) {
    await generateThumbnail(path.basename(filePath));
  }
}

async function generateThumbnail(svgFilename: string) {
  const key = path.basename(svgFilename, ".svg");
  const svgPath = path.join(DECOR_SRC_DIR, svgFilename);
  const pngPath = path.join(DECOR_PUBLIC_DIR, `${key}.thumbnail.png`);

  try {
    const image = await loadImage(svgPath);
    const canvas = new Canvas(THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    const ct = canvas.getContext("2d");

    // fit within THUMBNAIL_SIZE preserving aspect ratio
    const scale = Math.min(THUMBNAIL_SIZE / image.width, THUMBNAIL_SIZE / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    ct.drawImage(image, (THUMBNAIL_SIZE - w) / 2, (THUMBNAIL_SIZE - h) / 2, w, h);

    await canvas.toFile(pngPath);
    info(`[watch-decor] generated ${key}.thumbnail.png`);
  } catch (e) {
    warn(`[watch-decor] failed to generate thumbnail for ${svgFilename}:`, e);
  }
}
