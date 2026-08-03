import fs from "node:fs";
import path from "node:path";

import { jobsExamplesApiPath, jobsExamplesChangedEvent } from "@npc-cli/ui__jobs/const";
import type { Plugin } from "vite";

import { PROJECT_ROOT } from "./const.ts";

const EXAMPLES_DIR = path.join(PROJECT_ROOT, "packages/ui/jobs/src/examples");
const VIRTUAL_ID = "virtual:jobs-examples";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const DEBOUNCE_MS = 100;

/**
 * Provides `packages/ui/jobs/src/examples/*.md` to `<JobsLibrary>`.
 *
 * They are bundled for production, but fetched during development,
 * so adding or renaming one need not trigger a full reload
 * (which `import.meta.glob` would).
 */
export function jobsExamplesPlugin(): Plugin {
  let isDev = false;

  return {
    name: "jobs-examples",

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
      return `export default ${JSON.stringify(isDev ? {} : readExamples())}`;
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split("?")[0] !== jobsExamplesApiPath) {
          return next();
        }
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(readExamples()));
      });

      let debounceTimer: null | ReturnType<typeof setTimeout> = null;

      const onChange = (filePath: string) => {
        if (!isExampleMd(filePath)) {
          return;
        }
        if (debounceTimer !== null) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          server.hot.send({ type: "custom", event: jobsExamplesChangedEvent });
        }, DEBOUNCE_MS);
      };

      // chokidar v4 has no glob support, so we watch the directory
      server.watcher.add(EXAMPLES_DIR);
      server.watcher.on("add", onChange);
      server.watcher.on("change", onChange);
      server.watcher.on("unlink", onChange);
    },
  };
}

function readExamples(): Record<string, string> {
  if (!fs.existsSync(EXAMPLES_DIR)) {
    return {};
  }
  return Object.fromEntries(
    fs
      .readdirSync(EXAMPLES_DIR)
      .filter((x) => x.endsWith(".md"))
      .map((x) => [x, fs.readFileSync(path.join(EXAMPLES_DIR, x), "utf8")]),
  );
}

function isExampleMd(filePath: string) {
  return filePath.startsWith(EXAMPLES_DIR) && filePath.endsWith(".md");
}
