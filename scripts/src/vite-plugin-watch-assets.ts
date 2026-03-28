import childProcess from "node:child_process";
import path from "node:path";
import { assetsJsonChangedEvent } from "@npc-cli/ui__world/const";
import type { Plugin, ViteDevServer } from "vite";
import { PROJECT_ROOT } from "./const.ts";

const PUBLIC_DIR = path.join(PROJECT_ROOT, "packages/app/public");
const GEN_ASSETS_BIN = path.join(PROJECT_ROOT, "scripts/src/bins/gen-assets-json.tsx");
const GEOMORPH_SERVICE = path.join(PROJECT_ROOT, "packages/ui/world/src/service/geomorph.ts");

export function watchAssetsPlugin(): Plugin {
  return {
    name: "watch-assets",
    configureServer(server) {
      const symbolGlob = path.join(PUBLIC_DIR, "symbol/*.json");
      const mapGlob = path.join(PUBLIC_DIR, "map/*.json");
      server.watcher.add([symbolGlob, mapGlob, GEOMORPH_SERVICE]);

      let debounceTimer: ReturnType<typeof setTimeout> | null = null;
      let running = false;
      const changed = new Map<string, number>();

      const isAssetInputFile = (filePath: string) =>
        !filePath.endsWith("manifest.json") &&
        (filePath.startsWith(path.join(PUBLIC_DIR, "symbol/")) || filePath.startsWith(path.join(PUBLIC_DIR, "map/"))) &&
        filePath.endsWith(".json");

      const isWatchedFile = (filePath: string) => filePath === GEOMORPH_SERVICE || isAssetInputFile(filePath);

      const runGenAssets = async (server: ViteDevServer) => {
        if (running) return;
        running = true;

        const startEpochMs = Date.now();
        const changedFiles = Array.from(changed.keys());
        console.log(`[watch-assets] running gen-assets-json for ${changedFiles.length} file(s)`);

        try {
          await new Promise<void>((resolve, reject) => {
            const proc = childProcess.spawn(
              "node",
              ["--import=tsx", GEN_ASSETS_BIN, `--changedFiles=${JSON.stringify(changedFiles)}`],
              { cwd: PROJECT_ROOT, stdio: "inherit" },
            );
            proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`exit code ${code}`))));
            proc.on("error", reject);
          });
          server.hot.send({ type: "custom", event: assetsJsonChangedEvent });
        } catch (err) {
          console.error("[watch-assets] gen-assets-json failed:", err);
        }

        changed.forEach((epochMs, file) => epochMs <= startEpochMs && changed.delete(file));
        running = false;
        if (changed.size > 0) {
          await runGenAssets(server);
        }
      };

      const onFileChange = (filePath: string) => {
        if (!isWatchedFile(filePath)) return;
        if (isAssetInputFile(filePath)) changed.set(filePath, Date.now());
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => runGenAssets(server), 30);
      };

      server.watcher.on("change", onFileChange);
      server.watcher.on("add", onFileChange);
    },
  };
}
