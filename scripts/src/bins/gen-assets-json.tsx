#!/usr/bin/env node --import=tsx

/**
 * 🚧 WIP
 * - `parsed` -- symbol key to derived geometry and metadata
 * - `stratified` -- stratified directed graph
 * - `flattened` -- lookup i.e. recursively unwind sub-symbols
 * - `layouts` -- hull symbol wrappers
 *
 * USAGE:
 * ```sh
 * pnpm gen-assets-json
 * pnpm gen-assets-json --changedFiles='["packages/app/public/symbol/console--051--0.4x0.6.json"]'
 *
 * # see also
 * pnpm watch-symbols
 * ```
 *
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { MapEditSavedFileSchema, SymbolJsonFilenameSchema } from "@npc-cli/ui__map-edit/map-node-api";
import { jsonParser } from "@npc-cli/util/json-parser";
import { error, info, safeJsonCompact, safeJsonParse } from "@npc-cli/util/legacy/generic";
import z from "zod";

const opts = parseArgs({
  args: process.argv.slice(2),
  options: { changedFiles: { type: "string" } },
});

/** Paths .../packages/app/public/symbol/{symbolKey}.json */
const changedFiles = (
  (safeJsonParse(opts.values.changedFiles || "null") as string[] | null) ??
  fs.globSync("packages/app/public/symbol/*.json")
).filter((filePath) => SymbolJsonFilenameSchema.safeParse(path.basename(filePath)).success);

if (!Array.isArray(changedFiles) || !changedFiles.every((file) => typeof file === "string")) {
  throw new Error("If present --changedFiles must be a JSON array of strings.");
}

info(`[gen-assets-json]`, `changedFiles: ${safeJsonCompact(changedFiles)}`);

for (const file of changedFiles) {
  const result = jsonParser.pipe(MapEditSavedFileSchema).safeParse(fs.readFileSync(file, "utf-8"));
  if (!result.success) {
    error(`${file}: skipping invalid MapEditSavedFile JSON: ${safeJsonCompact(z.prettifyError(result.error))}`);
    continue;
  }

  console.log("🚧", { file });
  // const savedFile = result.data;
}
