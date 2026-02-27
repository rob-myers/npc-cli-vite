#!/usr/bin/env node --import=tsx

// USAGE:
// pnpm process-symbols --changedFiles='["packages/app/public/symbol/untitled.json"]'

import React from "react";
import ReactDOM from "react-dom/server";

// Fix "React is not defined"
global.React = React;

import fs from "node:fs";
import { ansi } from "@npc-cli/cli/shell/const";
import { type MapNode, RenderMapNodes } from "@npc-cli/ui__map-edit";
import { info, safeJsonParse, warn } from "@npc-cli/util/legacy/generic";
//@ts-expect-error
import getopts from "getopts";

const opts = getopts(process.argv, { string: ["changedFiles"] });
const changedFiles = safeJsonParse(opts.changedFiles || "[]") as string[];
if (!Array.isArray(changedFiles) || !changedFiles.every((file) => typeof file === "string")) {
  throw new Error("If present --changedFiles must be a JSON array of strings.");
}

info(
  `[${ansi.Yellow}process-symbols${ansi.Reset}]`,
  `changedFiles: ${JSON.stringify(changedFiles)}`,
);

const emptyStringsSet = new Set<string>();

for (const file of fs.globSync("packages/app/public/symbol/**/*.json")) {
  const elements = safeJsonParse(fs.readFileSync(file, "utf-8")) as MapNode[];
  if (elements === null) {
    warn(`${file}: skipping invalid JSON`);
    continue;
  }

  // 🚧 need: width, height (maybe viewBox)
  const svgMarkup = ReactDOM.renderToStaticMarkup(
    <svg width="500" height="500" viewBox="0 0 500 500" xmlns="http://www.w3.org/2000/svg">
      <RenderMapNodes elements={elements} selectedIds={emptyStringsSet} />
    </svg>,
  );

  console.log({ file, elements, svgMarkup });
}
