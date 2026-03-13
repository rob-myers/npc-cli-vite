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
 * pnpm watch-symbols
 * ```
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { MapEditSavedFileSchema } from "@npc-cli/ui__map-edit/map-node-api";
import { jsonParser } from "@npc-cli/util/json-parser";
import { error, info, safeJsonCompact } from "@npc-cli/util/legacy/generic";
import z from "zod";
import { PROJECT_ROOT } from "../const";
import * as geomorph from "../service/geomorph";
import { perf } from "../service/performance";

const opts = parseArgs({
  args: process.argv.slice(2),
  options: { changedFiles: { type: "string" } },
});

const inputChangedFiles = jsonParser.pipe(z.array(z.string())).safeParse(opts.values.changedFiles)?.data;
if (opts.values.changedFiles !== undefined && !inputChangedFiles) {
  error("When present --changedFiles must be a JSON array of strings.");
  process.exit(1);
}

const changedFiles = (
  inputChangedFiles ??
  fs.globSync([
    path.resolve(PROJECT_ROOT, "packages/app/public/symbol/*.json"),
    path.resolve(PROJECT_ROOT, "packages/app/public/map/*.json"),
  ])
).filter((filePath) => path.basename(filePath) !== "manifest.json");

perf("begin");
info(`[gen-assets-json]`, `changedFiles: ${safeJsonCompact(changedFiles)}`);

perf("symbols/maps");

for (const file of changedFiles) {
  const symRes = jsonParser.pipe(MapEditSavedFileSchema).safeParse(fs.readFileSync(file, "utf-8"));
  if (!symRes.success) {
    error(`${path.basename(file)}: skipping invalid MapEditSavedFile JSON`);
    continue;
  }

  const savedFile = symRes.data;

  // 🚧 update assets.json
  if (savedFile.type === "symbol") {
    const symbol = geomorph.parseMapEditSymbol(savedFile);
    console.log("🚧 symbol", symbol.key);
  } else {
    const mapDef = geomorph.parseMapEditMap(savedFile);
    console.log("🚧 mapDef", mapDef.key);
  }
}

perf("symbols/maps");

perf("begin");
