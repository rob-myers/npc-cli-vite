import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

import { PROJECT_ROOT } from "./const.ts";

const ARTICLES_DIR = path.join(PROJECT_ROOT, "packages/ui/skip-net/src/articles");
const VIRTUAL_ID = "virtual:skip-net-articles";
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const AUTORUN_ID = "virtual:skip-net-autorun";
const RESOLVED_AUTORUN_ID = `\0${AUTORUN_ID}`;

/**
 * Provides each SkipNet article's size and last modified time, by key e.g. `npc-spawn`.
 * A build dates each by its last commit, as a checkout's file times mean nothing.
 * Also, as `virtual:skip-net-autorun`, the shell fences with a command autorunning by default.
 */
export function skipNetArticlesPlugin(): Plugin {
  let isDev = false;

  return {
    name: "skip-net-articles",

    configResolved(config) {
      isDev = config.command === "serve";
    },

    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : id === AUTORUN_ID ? RESOLVED_AUTORUN_ID : undefined;
    },

    load(id) {
      if (id === RESOLVED_ID) return `export default ${JSON.stringify(readArticles(isDev))}`;
      if (id === RESOLVED_AUTORUN_ID) return `export default ${JSON.stringify(readAutorunFences())}`;
    },

    configureServer(server) {
      const onChange = (filePath: string) => {
        if (!filePath.startsWith(ARTICLES_DIR) || !filePath.endsWith(".mdx")) return;
        for (const id of [RESOLVED_ID, RESOLVED_AUTORUN_ID]) {
          const mod = server.moduleGraph.getModuleById(id);
          if (mod) void server.reloadModule(mod);
        }
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
      .readdirSync(ARTICLES_DIR, { recursive: true, encoding: "utf8" })
      .filter((x) => x.endsWith(".mdx"))
      .map((x) => {
        const file = path.join(ARTICLES_DIR, x);
        const stat = fs.statSync(file);
        return [
          path.basename(x, ".mdx"),
          { bytes: stat.size, modifiedMs: isDev ? stat.mtimeMs : (committedMs(file) ?? stat.mtimeMs) },
        ];
      }),
  );
}

/** Each shell fence with a `# @bootable mobile` or `desktop` line, its source as MDX gives it */
function readAutorunFences(): { articleKey: string; src: string }[] {
  return fs
    .readdirSync(ARTICLES_DIR, { recursive: true, encoding: "utf8" })
    .filter((x) => x.endsWith(".mdx"))
    .flatMap((x) => {
      const text = fs.readFileSync(path.join(ARTICLES_DIR, x), "utf8");
      return [...text.matchAll(fenceRe)].flatMap(([, lang, src]) =>
        shellLangs.has(lang) && autorunLineRe.test(src) ? { articleKey: path.basename(x, ".mdx"), src } : [],
      );
    });
}

/** A fence at column 0: its language, then its lines each ending in a newline, as MDX hands them to `ShellFence` */
const fenceRe = /^```(\w*)[^\n]*\n([\s\S]*?)^```[ \t]*$/gm;
const shellLangs = new Set(["", "sh", "bash"]);
const autorunLineRe = /^#\s*@bootable\s+(?:mobile|desktop)\b/m;

/** When the file was last committed, if ever */
function committedMs(file: string): undefined | number {
  try {
    const seconds = execFileSync("git", ["log", "-1", "--format=%ct", "--", file], { encoding: "utf8" }).trim();
    return seconds === "" ? undefined : Number(seconds) * 1000;
  } catch {
    return undefined;
  }
}
