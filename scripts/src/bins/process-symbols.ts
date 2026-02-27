#!/usr/bin/env node --import=tsx

// USAGE:
// pnpm process-symbols --changedFiles='["packages/app/public/symbol/untitled.json"]'

import fs from "node:fs";
import { ansi } from "@npc-cli/cli/shell/const";
import type { MapNode } from "@npc-cli/ui__map-edit";
import { safeJsonParse, warn } from "@npc-cli/util/legacy/generic";
//@ts-expect-error
import getopts from "getopts";

const opts = getopts(process.argv, { string: ["changedFiles"] });
const changedFiles = safeJsonParse(opts.changedFiles || "[]") as string[];
if (!Array.isArray(changedFiles) || !changedFiles.every((file) => typeof file === "string")) {
  throw new Error("Invalid value for --changedFiles. Expected a JSON array of strings.");
}

console.log(
  `[${ansi.Yellow}process-symbols${ansi.Reset}]`,
  `changedFiles: ${JSON.stringify(changedFiles)}`,
);

for (const file of fs.globSync("packages/app/public/symbol/**/*.json")) {
  const data = safeJsonParse(fs.readFileSync(file, "utf-8")) as MapNode[];
  if (data === null) {
    warn(`${file}: skipping invalid JSON`);
    continue;
  }
  console.log({ file, data });
}
