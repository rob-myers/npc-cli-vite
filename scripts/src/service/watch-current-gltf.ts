import childProcess from "node:child_process";
import path from "node:path";
import { devMessageFromServer } from "@npc-cli/ui__map-edit/map-node-api";
import { warn } from "@npc-cli/util/legacy/generic";
import type { ViteDevServer } from "vite";

import { PROJECT_ROOT } from "../const.ts";

const CURRENT_GLTF_PATH = path.join(PROJECT_ROOT, "packages/media/src/blockbench/current/current.gltf");

/** On each save of `current.gltf`, rewrites `current.glb` and tells the browser to refetch */
export function watchCurrentGltf(server: ViteDevServer) {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const onChange = (filePath: string) => {
    if (filePath !== CURRENT_GLTF_PATH) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const proc = childProcess.spawn("pnpm", ["exec", "gen-current-glb"], { cwd: PROJECT_ROOT, stdio: "inherit" });
      // after the glb is written, as a page may load it instead
      proc.on("close", (code) => {
        if (code !== 0) warn(`[watch-current-gltf] gen-current-glb exit code ${code}`);
        server.hot.send({ type: "custom", event: devMessageFromServer.currentGltfChanged });
      });
    }, 200);
  };

  server.watcher.add(CURRENT_GLTF_PATH);
  server.watcher.on("add", onChange);
  server.watcher.on("change", onChange);
}
