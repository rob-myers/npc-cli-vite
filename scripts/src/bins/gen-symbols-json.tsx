#!/usr/bin/env node --import=tsx

/**
 * 🚧 TODO
 * - ensure symbols flattened i.e. recursively unwind sub-symbols
 * - arrange as stratified directed graph
 * - create layouts i.e. hull symbol wrappers
 *
 * USAGE:
 * ```sh
 * pnpm gen-symbols-json
 * pnpm gen-symbols-json --changedFiles='["packages/app/public/symbol/untitled.json"]'
 * ```
 *
 */
import fs from "node:fs";
import { ansi } from "@npc-cli/cli/shell/const";
import { MapEditSavedFileSchema } from "@npc-cli/ui__map-edit/map-node-api";
import { jsonParser } from "@npc-cli/util/json-parser";
import { error, info, safeJsonCompact, safeJsonParse } from "@npc-cli/util/legacy/generic";

// 🚧 use node parseArgs
//@ts-expect-error
import getopts from "getopts";
import z from "zod";

const opts = getopts(process.argv, { string: ["changedFiles"] });
const changedFiles = safeJsonParse(opts.changedFiles || "[]") as string[];
if (!Array.isArray(changedFiles) || !changedFiles.every((file) => typeof file === "string")) {
  throw new Error("If present --changedFiles must be a JSON array of strings.");
}

info(`[${ansi.Yellow}gen-symbols-json${ansi.Reset}]`, `changedFiles: ${JSON.stringify(changedFiles)}`);

// 🚧 account for changedFiles
for (const file of fs.globSync("packages/app/public/symbol/**/*.json")) {
  const result = jsonParser.pipe(MapEditSavedFileSchema).safeParse(fs.readFileSync(file, "utf-8"));
  if (!result.success) {
    error(`${file}: skipping invalid MapEditSavedFile JSON: ${safeJsonCompact(z.flattenError(result.error))}`);
    continue;
  }

  // 🚧 recursively construct flattened symbols
  const savedFile = result.data;
  console.log({ file, savedFile });
}
