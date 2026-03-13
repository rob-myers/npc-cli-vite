#!/usr/bin/env node --import=tsx

/**
 * 🚧 WIP
 * - `parsed` -- symbol key to geometry/metadata
 * - `stratified` -- stratified directed graph
 * - `flattened` -- symbol key to unwound symbols (includes hull symbols)
 *
 * USAGE:
 * ```sh
 * pnpm gen-assets-json
 * pnpm gen-assets-json --changedFiles='["/path/to/.../public/symbol/console--051--0.4x0.6.json"]'
 *
 * # see also
 * pnpm watch-symbols
 * ```
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { MapEditSavedFileSchema, SymbolJsonFilenameSchema } from "@npc-cli/ui__map-edit/map-node-api";
import { jsonParser } from "@npc-cli/util/json-parser";
import { error, info, safeJsonCompact } from "@npc-cli/util/legacy/generic";
import z from "zod";
import { PROJECT_ROOT } from "../const";

const opts = parseArgs({
  args: process.argv.slice(2),
  options: { changedFiles: { type: "string" } },
});

const inputChangedFiles = jsonParser.pipe(z.array(z.string())).safeParse(opts.values.changedFiles)?.data;
if (opts.values.changedFiles !== undefined && !inputChangedFiles) {
  error("When present --changedFiles must be a JSON array of strings.");
  process.exit(1);
}

/** Paths .../packages/app/public/symbol/{symbolKey}.json */
const changedFiles = (
  inputChangedFiles ?? fs.globSync(path.resolve(PROJECT_ROOT, "packages/app/public/symbol/*.json"))
).filter((filePath) => SymbolJsonFilenameSchema.safeParse(path.basename(filePath)).success);

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
