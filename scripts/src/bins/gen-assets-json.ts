#!/usr/bin/env node --import=tsx

/**
 * - `assets.json` -- maps, and a hash per layout file
 * - `assets-edit.json` -- symbols, flattened symbols and their stratification
 * - `layout/{gmKey}.json` -- one layout per geomorph
 *
 * The dev server runs `genAssetsJson` in-process instead (`vite-plugin-watch-assets`).
 *
 * USAGE:
 * ```sh
 * pnpm gen-assets-json
 * pnpm gen-assets-json --changedFiles='["/path/to/.../public/symbol/console--051.json"]'
 *
 * # force recompute stratification
 * pnpm gen-assets-json --force
 * ```
 */
import { parseArgs } from "node:util";
import { jsonParser } from "@npc-cli/util/json-parser";
import { error } from "@npc-cli/util/legacy/generic";
import z from "zod";
import { genAssetsJson } from "../service/gen-assets-json";

const opts = parseArgs({
  args: process.argv.slice(2),
  options: { changedFiles: { type: "string" }, force: { type: "boolean" } },
});

const changedFiles = jsonParser.pipe(z.array(z.string())).safeParse(opts.values.changedFiles)?.data;
if (opts.values.changedFiles !== undefined && !changedFiles) {
  error("When present --changedFiles must be a JSON array of strings.");
  process.exit(1);
}

genAssetsJson({ changedFiles, force: opts.values.force });
