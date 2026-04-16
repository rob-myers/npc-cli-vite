import childProcess from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { WorldThemeSchema } from "@npc-cli/ui__world/assets.schema";
import { jsonParser } from "@npc-cli/util/json-parser";
import { safeJsonCompact } from "@npc-cli/util/legacy/generic";
import type { Plugin, ViteDevServer } from "vite";

import { PROJECT_ROOT } from "./const.ts";

const PUBLIC_DIR = path.join(PROJECT_ROOT, "packages/app/public");
const ASSETS_JSON_PATH = path.join(PUBLIC_DIR, "assets.json");
const GEN_ASSETS_BIN = path.join(PROJECT_ROOT, "scripts/src/bins/gen-assets-json.ts");
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
        server.hot.send({ type: "custom", event: assetsJsonChangingEvent });

        try {
          // const prevHash = (await getAssetsJsonOrNull())?.hash;

          // generate assets.json
          await new Promise<void>((resolve, reject) => {
            const proc = childProcess.spawn(
              "node",
              ["--import=tsx", GEN_ASSETS_BIN, `--changedFiles=${JSON.stringify(changedFiles)}`],
              { cwd: PROJECT_ROOT, stdio: "inherit" },
            );
            proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`exit code ${code}`))));
            proc.on("error", reject);
          });
          // inform browser
          server.hot.send({ type: "custom", event: assetsJsonChangedEvent });

          // const postHash = (await getAssetsJsonOrNull())?.hash;
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

      server.middlewares.use(async (req, res, next) => {
        const match = req.url?.match(/^\/api\/assets\/theme\/(.+)$/);
        if (!match || req.method !== "POST") return next();

        let body = "";
        for await (const chunk of req) body += chunk;
        const parsed = jsonParser.pipe(WorldThemeSchema).safeParse(body);
        if (!parsed.success) {
          res.writeHead(400).end();
          return;
        }

        const assets = JSON.parse(fs.readFileSync(ASSETS_JSON_PATH, "utf-8"));
        assets.theme ??= {};
        assets.theme[decodeURIComponent(match[1])] = parsed.data;
        fs.writeFileSync(ASSETS_JSON_PATH, safeJsonCompact(assets));
        res.writeHead(200).end();
      });
    },
  };
}

// Type mirroring avoids HMR issue
type WorldConst = typeof import("@npc-cli/ui__world/const");
const assetsJsonChangingEvent: WorldConst["assetsJsonChangingEvent"] = "assets-json-changing";
const assetsJsonChangedEvent: WorldConst["assetsJsonChangedEvent"] = "assets-json-changed";

async function _getAssetsJsonOrNull() {
  return (
    jsonParser.safeParse(await fs.promises.readFile(path.join(PUBLIC_DIR, "assets.json"), "utf-8").catch(() => null))
      ?.data ?? null
  );
}
