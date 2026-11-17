import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

import { PROJECT_ROOT } from "./const.ts";

const ARTICLES_DIR = path.join(PROJECT_ROOT, "packages/ui/skip-net/src/articles");
const VIRTUAL_ID = "virtual:skip-net-articles";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

/**
 * Provides each SkipNet article's size and last modified time, by key e.g. `npc-spawn`.
 * A build dates each by its last commit, as a checkout's file times mean nothing.
 */
export function skipNetArticlesPlugin(): Plugin {
  let isDev = false;

  return {
    name: "skip-net-articles",

    configResolved(config) {
      isDev = config.command === "serve";
    },

    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },

    load(id) {
      if (id !== RESOLVED_ID) return;
      return `export default ${JSON.stringify(readArticles(isDev))}`;
    },

    configureServer(server) {
      const onChange = (filePath: string) => {
        if (!filePath.startsWith(ARTICLES_DIR) || !filePath.endsWith(".mdx")) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (mod) void server.reloadModule(mod);
      };
      server.watcher.on("add", onChange);
      server.watcher.on("change", onChange);
      server.watcher.on("unlink", onChange);
    },
  };
}

function readArticles(isDev: boolean): Record<string, { bytes: number; modifiedMs: number }> {
  return Object.fromEntries(
    fs
      .readdirSync(ARTICLES_DIR)
      .filter((x) => x.endsWith(".mdx"))
      .map((x) => {
        const file = path.join(ARTICLES_DIR, x);
        const stat = fs.statSync(file);
        return [
          x.slice(0, -".mdx".length),
          { bytes: stat.size, modifiedMs: isDev ? stat.mtimeMs : (committedMs(file) ?? stat.mtimeMs) },
        ];
      }),
  );
}

/** When the file was last committed, if ever */
function committedMs(file: string): undefined | number {
  try {
    const seconds = execFileSync("git", ["log", "-1", "--format=%ct", "--", file], { encoding: "utf8" }).trim();
    return seconds === "" ? undefined : Number(seconds) * 1000;
  } catch {
    return undefined;
  }
}
