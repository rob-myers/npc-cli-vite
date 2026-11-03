import fs from "node:fs";
import path from "node:path";

import type { Plugin } from "vite";

import { PROJECT_ROOT } from "./const.ts";

const DEFAULTS_FILE = path.join(PROJECT_ROOT, "packages/ui/audio/src/audio-defaults.json");
/** As `audioDefaultsApiPath` in the Audio desk */
const API_PATH = "/api/audio/defaults";

/**
 * In DEV, the Audio desk saves its levels as the defaults: `POST /api/audio/defaults`.
 * Only the file's own keys are kept, each a number from `0` to `1`.
 */
export function audioDefaultsPlugin(): Plugin {
  return {
    name: "audio-defaults",
    apply: "serve",

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== API_PATH || req.method !== "POST") {
          return next();
        }
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const current: Record<string, number> = JSON.parse(fs.readFileSync(DEFAULTS_FILE, "utf8"));
            const next: Record<string, unknown> = JSON.parse(body);
            for (const key of Object.keys(current)) {
              const value = next[key];
              if (typeof value === "number" && Number.isFinite(value)) current[key] = Math.min(1, Math.max(0, value));
            }
            fs.writeFileSync(DEFAULTS_FILE, `${JSON.stringify(current, null, 2)}\n`);
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(current));
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
    },
  };
}
