import fs from "node:fs";
import path from "node:path";
import { devMessageFromServer } from "@npc-cli/ui__map-edit/map-node-api";
import type { ViteDevServer } from "vite";
import { PROJECT_ROOT } from "../const.ts";

// SKIN_PUBLIC_DIR is actually a symlink to packages/media/src/skin
const SKIN_PUBLIC_DIR = path.join(PROJECT_ROOT, "packages/app/public/skin");

export function watchSkinSvgs(server: ViteDevServer) {
  fs.mkdirSync(SKIN_PUBLIC_DIR, { recursive: true });

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const rebuild = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      server.hot.send({ type: "custom", event: devMessageFromServer.skinSvgsChanged });
    }, 200);
  };

  server.watcher.add(path.join(SKIN_PUBLIC_DIR, "*.svg"));
  server.watcher.on("add", (filePath) => isSkinSvg(filePath) && rebuild());
  server.watcher.on("change", (filePath) => isSkinSvg(filePath) && rebuild());
  server.watcher.on("unlink", (filePath) => isSkinSvg(filePath) && rebuild());
}

function isSkinSvg(filePath: string) {
  return filePath.startsWith(SKIN_PUBLIC_DIR) && filePath.endsWith(".svg");
}
