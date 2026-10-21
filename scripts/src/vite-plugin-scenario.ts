import fs from "node:fs";
import path from "node:path";

import {
  isScenarioKey,
  type ScenarioEntry,
  ScenarioEntrySchema,
  scenarioApiPath,
  scenarioChangedEvent,
  scenarioKinds,
} from "@npc-cli/ui__world/scenario.schema";
import stringify from "json-stringify-pretty-compact";
import type { Plugin } from "vite";

import { PROJECT_ROOT } from "./const.ts";

const SCENARIO_DIR = path.join(PROJECT_ROOT, "packages/media/src/scenario");
const VIRTUAL_ID = "virtual:scenario";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const DEBOUNCE_MS = 100;
const FILE_PREFIX = `${scenarioApiPath}/file/`;
const SCHEMA_PATH = path.join(PROJECT_ROOT, "packages/ui/world/src/scenario.schema.ts");

/**
 * Provides `packages/media/src/scenario/{kind}/{slug}.json` to the Scenario panel — see `docs/scenarios.md`.
 *
 * Bundled for production, but fetched (and saved) during development, as `jobsExamplesPlugin` does.
 */
export function scenarioPlugin(): Plugin {
  let isDev = false;

  return {
    name: "scenario",

    configResolved(config) {
      isDev = config.command === "serve";
    },

    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },

    load(id) {
      if (id !== RESOLVED_ID) {
        return;
      }
      return `export default ${JSON.stringify(isDev ? {} : readEntries())}`;
    },

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = decodeURIComponent(req.url?.split("?")[0] ?? "");
        if (url !== scenarioApiPath && !url.startsWith(FILE_PREFIX)) {
          return next();
        }
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        try {
          // loaded afresh, so an edit to the schema needs no restart: the static import is cached
          const { ScenarioEntrySchema } = (await server.ssrLoadModule(SCHEMA_PATH)) as ScenarioSchemaModule;
          if (url === scenarioApiPath && req.method === "GET") {
            return res.end(JSON.stringify(readEntries(ScenarioEntrySchema)));
          }
          const key = url.slice(FILE_PREFIX.length);
          const filePath = path.join(SCENARIO_DIR, `${key}.json`);
          // the key's shape already rules out traversal; the prefix check is belt and braces
          if (!isScenarioKey(key) || !filePath.startsWith(SCENARIO_DIR + path.sep)) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ error: `invalid scenario key: ${key}` }));
          }
          if (req.method === "POST") {
            let body = "";
            for await (const chunk of req) body += chunk;
            const entry = ScenarioEntrySchema.parse(JSON.parse(body));
            if (entry.key !== key || entry.kind !== key.split("/")[0]) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: `entry is not ${key}` }));
            }
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, `${stringify(entry, { maxLength: 120 })}\n`);
            return res.end(JSON.stringify({ success: true }));
          }
          if (req.method === "DELETE") {
            fs.rmSync(filePath, { force: true });
            return res.end(JSON.stringify({ success: true }));
          }
          res.statusCode = 404;
          res.end(JSON.stringify({ error: "not found" }));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
        }
      });

      let debounceTimer: null | ReturnType<typeof setTimeout> = null;

      const onChange = (filePath: string) => {
        if (!filePath.startsWith(SCENARIO_DIR) || !filePath.endsWith(".json")) {
          return;
        }
        if (debounceTimer !== null) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          server.hot.send({ type: "custom", event: scenarioChangedEvent });
        }, DEBOUNCE_MS);
      };

      // chokidar v4 has no glob support, so we watch the directory
      server.watcher.add(SCENARIO_DIR);
      server.watcher.on("add", onChange);
      server.watcher.on("change", onChange);
      server.watcher.on("unlink", onChange);
    },
  };
}

/** By key; a file that does not parse is skipped with a warning */
function readEntries(
  schema: ScenarioSchemaModule["ScenarioEntrySchema"] = ScenarioEntrySchema,
): Record<string, ScenarioEntry> {
  const entries: Record<string, ScenarioEntry> = {};
  for (const kind of scenarioKinds) {
    const dir = path.join(SCENARIO_DIR, kind);
    if (!fs.existsSync(dir)) continue;
    for (const filename of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const key = `${kind}/${filename.slice(0, -".json".length)}`;
      try {
        const entry = schema.parse(JSON.parse(fs.readFileSync(path.join(dir, filename), "utf8")));
        entries[key] = { ...entry, key, kind };
      } catch (e) {
        console.warn(`[scenario] skipped ${key}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  return entries;
}

type ScenarioSchemaModule = typeof import("@npc-cli/ui__world/scenario.schema");
