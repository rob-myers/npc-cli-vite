import childProcess from "node:child_process";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { PROJECT_ROOT } from "./const.ts";

const ASSETS_JSON_PATH = path.join(PROJECT_ROOT, "packages/app/public/assets.json");
const GEN_SPOTS_BIN = path.join(PROJECT_ROOT, "scripts/src/bins/gen-spots.ts");
/** Their code: edited, every geomorph's spots are made again */
const SPOT_SOURCES = ["spots.ts", "spot-sight.ts", "seg-grid.ts"].map((name) =>
  path.join(PROJECT_ROOT, "packages/ui/world/src/service", name),
);

/** Remakes `public/spot/*.json` in a child process once `assets.json` or their code changes — see `docs/spots.md` */
export function spotsPlugin(): Plugin {
  return {
    name: "spots",
    configureServer(server) {
      let running = false;
      /** A change arrived mid-run: run again after */
      let again = false;
      let debounceTimer: null | ReturnType<typeof setTimeout> = null;

      const run = async (server: ViteDevServer, force = false) => {
        if (running) return void (again = true);
        running = true;
        server.hot.send({ type: "custom", event: spotsGeneratingEvent, data: { running: true } });
        try {
          await genSpots(force);
          server.hot.send({ type: "custom", event: spotsChangedEvent });
        } catch (err) {
          console.error("[spots] gen-spots failed:", err);
        }
        server.hot.send({ type: "custom", event: spotsGeneratingEvent, data: { running: false } });
        running = false;
        if (again) {
          again = false;
          await run(server);
        }
      };

      const onFileChange = (filePath: string) => {
        if (filePath !== ASSETS_JSON_PATH && !SPOT_SOURCES.includes(filePath)) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => run(server), 200);
      };

      server.watcher.add(SPOT_SOURCES);
      server.watcher.on("change", onFileChange);
      server.watcher.on("add", onFileChange);

      server.middlewares.use(async (req, res, next) => {
        if (req.url !== "/api/gen-spots" || req.method !== "POST") return next();
        await run(server, true);
        res.writeHead(200).end();
      });
    },
  };
}

function genSpots(force: boolean) {
  return new Promise<void>((resolve, reject) => {
    const proc = childProcess.spawn("node", ["--import=tsx", GEN_SPOTS_BIN, ...(force ? ["--force"] : [])], {
      cwd: PROJECT_ROOT,
      stdio: "inherit",
    });
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`exit code ${code}`))));
    proc.on("error", reject);
  });
}

// Type mirroring avoids HMR issue
type SpotSchema = typeof import("@npc-cli/ui__world/spot.schema");
const spotsChangedEvent: SpotSchema["spotsChangedEvent"] = "spots-changed";
const spotsGeneratingEvent: SpotSchema["spotsGeneratingEvent"] = "spots-generating";
