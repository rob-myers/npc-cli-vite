#!/usr/bin/env node

/**
 * Writes README.md from the About modal's text (`about.mdx`), its notices included.
 * ```sh
 * pnpm sync-readme
 * ```
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const aboutPath = resolve(root, "packages/app/src/components/about.mdx");
const readmePath = resolve(root, "README.md");

const header = "<!-- pnpm sync-readme writes this from packages/app/src/components/about.mdx: edit that instead -->";

const mdx = readFileSync(aboutPath, "utf8");
const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}="([^"]*)"`))?.[1];

const [about, notices = ""] = mdx.split("<Notices>");

const body = about
  .replace(/^\{\/\*\*.*\*\/\}\n/m, "")
  .replace(/<Abbr title="[^"]*">([^<]*)<\/Abbr>/g, "$1")
  .replace(/<Video [^>]*\/>/g, (tag) => {
    const [id, title] = [attr(tag, "id"), attr(tag, "title") ?? "video"];
    return `[![${title}](https://img.youtube.com/vi/${id}/hqdefault.jpg)](https://www.youtube.com/watch?v=${id})`;
  })
  .replace(/^[ \t]*<\/?Screenshots>\n/gm, "")
  .replace(/^[ \t]*<Screenshot [^>]*\/>/gm, (tag) => {
    const [src, caption] = [attr(tag, "src"), attr(tag, "caption")];
    const alt = attr(tag, "alt") ?? caption ?? "";
    return caption === undefined
      ? `<img src="${src}" alt="${alt}" />`
      : `<img src="${src}" alt="${alt}" />\n\n*${caption}*`;
  })
  .replace(/\n{3,}/g, "\n\n")
  .trim();

/** The notices under one heading of their own, so each of theirs is a level down */
const noticesMd = notices
  .replace("</Notices>", "")
  .replace(/^## /gm, "### ")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const next = `# NPC CLI\n\n${header}\n\n${body}\n\n## Notices and licenses\n\n${noticesMd}\n`;
if (next !== readFileSync(readmePath, "utf8")) {
  writeFileSync(readmePath, next);
  console.log("sync-readme: README.md updated");
}
