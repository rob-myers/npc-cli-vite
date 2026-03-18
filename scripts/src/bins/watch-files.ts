#!/usr/bin/env node --import=tsx

/**
 * USAGE:
 * ```sh
 * pnpm -F scripts watch-assets
 * ```
 */

import { parseArgs } from "node:util";
import { error, info, safeJsonParse } from "@npc-cli/util/legacy/generic";
import nodemon, { type NodemonEventQuit } from "nodemon";
import { PROJECT_ROOT } from "../const";
import { labelledSpawn } from "../service/rename-starship-symbols";

const opts = parseArgs({
  args: process.argv.slice(2),
  options: { globs: { type: "string" }, pnpmBin: { type: "string" } },
});

const globs = safeJsonParse(opts.values.globs ?? "");
if (!Array.isArray(globs) || !globs.every((glob) => typeof glob === "string")) {
  error("Invalid --globs argument. Must be a JSON array of strings.");
  process.exit(1);
}

const pnpmBin = opts.values.pnpmBin;

if (!pnpmBin || typeof pnpmBin !== "string" || !/^[-a-z0-9]+$/.test(pnpmBin)) {
  error("Invalid --pnpmBin argument. Must be a non-empty lowercase alphanumeric string.");
  process.exit(1);
}

// console.log(opts);

/** Is the script currently running? */
let running = false;
/** We pause to allow multiple changes to aggregate */
const delayMs = 300;
/** Absolute path to `Date.now()` */
const changed = /** @type {Map<string, number>} */ (new Map());

nodemon({
  delay: 0.1,
  ext: "json",
  runOnChangeOnly: true,
  script: "scripts/src/bins/noop.js", // 🔔 must override default behaviour
  cwd: PROJECT_ROOT,
  // watch: ["packages/app/public/symbol/*.json"],
  watch: globs,
  exitCrash: true,
})
  .on("restart", onRestart)
  .on("quit", onQuit);

info("watching files...", globs);

async function onRestart(nodemonFiles = [] as string[]) {
  nodemonFiles.forEach((file) => changed.set(file, Date.now()));

  if (running) return;
  running = true;

  // pause to aggregate changes
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  const startEpochMs = Date.now();
  const changedFiles = Array.from(changed.keys());

  // Run the script
  // console.log({ changedFiles });
  await labelledSpawn(pnpmBin as string, pnpmBin as string, `--changedFiles=${JSON.stringify(changedFiles)}`);

  const seconds = ((Date.now() - startEpochMs) / 1000).toFixed(2);
  info(`took ${seconds}s`);

  changed.forEach((epochMs, file) => epochMs <= startEpochMs && changed.delete(file));
  running = false;
  if (changed.size > 0) {
    // something changed after we started the script
    await onRestart();
  }
}

function onQuit(_code?: NodemonEventQuit) {
  // console.log('quit', code);
  process.exit();
}
