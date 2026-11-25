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
  /** Each virtual module's last code, so an edit changing neither reloads nothing */
  const codeById = new Map<string, string>();
  const codeOf = (id: string) =>
    `export default ${JSON.stringify(id === RESOLVED_ID ? readArticles(isDev) : readAutorunFences())}`;

  return {
    name: "skip-net-articles",

    configResolved(config) {
      isDev = config.command === "serve";
    },

    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : id === AUTORUN_ID ? RESOLVED_AUTORUN_ID : undefined;
    },

    load(id) {
      if (id !== RESOLVED_ID && id !== RESOLVED_AUTORUN_ID) return;
      const code = codeOf(id);
      codeById.set(id, code);
      return code;
    },

    configureServer(server) {
      const onChange = (filePath: string) => {
        if (!filePath.startsWith(ARTICLES_DIR) || !filePath.endsWith(".mdx")) return;
        for (const id of [RESOLVED_ID, RESOLVED_AUTORUN_ID]) {
          const mod = server.moduleGraph.getModuleById(id);
          if (mod && codeOf(id) !== codeById.get(id)) void server.reloadModule(mod);
        }
      };
      server.watcher.on("add", onChange);
      server.watcher.on("change", onChange);
      server.watcher.on("unlink", onChange);
    },
  };
}

/** Each article's total size and newest time over its own file and sections */
function readArticles(isDev: boolean): Record<string, { bytes: number; modifiedMs: number }> {
  const byKey: Record<string, { bytes: number; modifiedMs: number }> = {};
  for (const x of readArticleFiles()) {
    const file = path.join(ARTICLES_DIR, x);
    const stat = fs.statSync(file);
    const modifiedMs = isDev ? stat.mtimeMs : (committedMs(file) ?? stat.mtimeMs);
    const prev = byKey[toKey(x)] ?? { bytes: 0, modifiedMs: 0 };
    byKey[toKey(x)] = { bytes: prev.bytes + stat.size, modifiedMs: Math.max(prev.modifiedMs, modifiedMs) };
  }
  return byKey;
}

/** Each shell fence with a `# @bootable @default` line (or `@default=mobile`, `=desktop`), its source as MDX gives it */
function readAutorunFences(): { articleKey: string; src: string }[] {
  return readArticleFiles().flatMap((x) => {
    const text = fs.readFileSync(path.join(ARTICLES_DIR, x), "utf8");
    return [...text.matchAll(fenceRe)].flatMap(([, lang, src]) =>
      shellLangs.has(lang) && autorunLineRe.test(src) ? { articleKey: toKey(x), src } : [],
    );
  });
}

/** A rehype plugin giving each fence's `code` its meta as `metastring`, e.g. `title="Move rob"` */
export function rehypeFenceMeta() {
  return (tree: HastNode) => withFenceMeta(tree);
}

type HastNode = {
  tagName?: string;
  data?: { meta?: null | string };
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

function withFenceMeta(node: HastNode) {
  if (node.tagName === "code" && node.data?.meta) {
    node.properties = { ...node.properties, metastring: node.data.meta };
  }
  for (const child of node.children ?? []) withFenceMeta(child);
}

/** Paths under `ARTICLES_DIR` as `articles.ts` globs them: `{folder}/{key}.mdx` or `{folder}/{key}/{section}.mdx` */
function readArticleFiles(): string[] {
  return fs
    .readdirSync(ARTICLES_DIR, { recursive: true, encoding: "utf8" })
    .filter((x) => x.endsWith(".mdx") && [2, 3].includes(x.split(path.sep).length));
}

/** `npc/npc-spawn.mdx` or `npc/npc-spawn/001-foo.mdx` -> `npc-spawn` */
function toKey(file: string) {
  return file.split(path.sep)[1].replace(/\.mdx$/, "");
}

/** A fence at column 0: its language, then its lines each ending in a newline, as MDX hands them to `ShellFence` */
const fenceRe = /^```(\w*)[^\n]*\n([\s\S]*?)^```[ \t]*$/gm;
const shellLangs = new Set(["", "sh", "bash"]);
const autorunLineRe = /^#\s*@bootable\b.*\s@default\b/m;

/** When the file was last committed, if ever */
function committedMs(file: string): undefined | number {
  try {
    const seconds = execFileSync("git", ["log", "-1", "--format=%ct", "--", file], { encoding: "utf8" }).trim();
    return seconds === "" ? undefined : Number(seconds) * 1000;
  } catch {
    return undefined;
  }
}
