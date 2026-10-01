import fs from "node:fs";
import path from "node:path";

import {
  isLoreKey,
  type LoreEntry,
  LoreEntrySchema,
  loreApiPath,
  loreChangedEvent,
  loreKinds,
} from "@npc-cli/ui__decorator/lore-schema";
import stringify from "json-stringify-pretty-compact";
import type { Plugin } from "vite";

import { PROJECT_ROOT } from "./const.ts";

const LORE_DIR = path.join(PROJECT_ROOT, "packages/media/lore");
const VIRTUAL_ID = "virtual:lore";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const DEBOUNCE_MS = 100;
const FILE_PREFIX = `${loreApiPath}/file/`;

/**
 * Provides `packages/media/lore/{kind}/{slug}.json` to the Decorator's lore pane — see `docs/lore.md`.
 *
 * Bundled for production, but fetched (and saved) during development, as `jobsExamplesPlugin` does.
 */
export function lorePlugin(): Plugin {
  let isDev = false;

  return {
    name: "lore",

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
        if (url !== loreApiPath && !url.startsWith(FILE_PREFIX)) {
          return next();
        }
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        try {
          if (url === loreApiPath && req.method === "GET") {
            return res.end(JSON.stringify(readEntries()));
          }
          const key = url.slice(FILE_PREFIX.length);
          const filePath = path.join(LORE_DIR, `${key}.json`);
          // the key's shape already rules out traversal; the prefix check is belt and braces
          if (!isLoreKey(key) || !filePath.startsWith(LORE_DIR + path.sep)) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ error: `invalid lore key: ${key}` }));
          }
          if (req.method === "POST") {
            let body = "";
            for await (const chunk of req) body += chunk;
            const entry = LoreEntrySchema.parse(JSON.parse(body));
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
        if (!filePath.startsWith(LORE_DIR) || !filePath.endsWith(".json")) {
          return;
        }
        if (debounceTimer !== null) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          server.hot.send({ type: "custom", event: loreChangedEvent });
        }, DEBOUNCE_MS);
      };

      // chokidar v4 has no glob support, so we watch the directory
      server.watcher.add(LORE_DIR);
      server.watcher.on("add", onChange);
      server.watcher.on("change", onChange);
      server.watcher.on("unlink", onChange);
    },
  };
}

/** By key; a file that does not parse is skipped with a warning */
function readEntries(): Record<string, LoreEntry> {
  const entries: Record<string, LoreEntry> = {};
  for (const kind of loreKinds) {
    const dir = path.join(LORE_DIR, kind);
    if (!fs.existsSync(dir)) continue;
    for (const filename of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
      const key = `${kind}/${filename.slice(0, -".json".length)}`;
      try {
        const entry = LoreEntrySchema.parse(JSON.parse(fs.readFileSync(path.join(dir, filename), "utf8")));
        entries[key] = { ...entry, key, kind };
      } catch (e) {
        console.warn(`[lore] skipped ${key}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }
  return entries;
}
