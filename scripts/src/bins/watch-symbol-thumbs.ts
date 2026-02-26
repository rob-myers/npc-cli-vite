#!/usr/bin/env node --import=tsx

import { info } from "@npc-cli/util/legacy/generic";
import nodemon, { type NodemonEventQuit } from "nodemon";
import { PROJECT_ROOT } from "../const";

// import { labelledSpawn } from "../starship-symbol/service";

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
  script: "scripts/src/noop.js", // 🔔 must override default behaviour
  cwd: PROJECT_ROOT,
  watch: ["packages/app/public/symbol/*.json"],
  exitCrash: true,
})
  .on("restart", onRestart)
  .on("quit", onQuit);

info("watching symbols...");

async function onRestart(nodemonFiles = [] as string[]) {
  nodemonFiles.forEach((file) => changed.set(file, Date.now()));

  if (running) return;
  running = true;

  // pause to aggregate changes
  await new Promise((resolve) => setTimeout(resolve, delayMs));

  const startEpochMs = Date.now();
  const changedFiles = Array.from(changed.keys());

  // 🚧 generate a thumbnail for each changed file
  // 🚧 also generate all initially
  console.log({ changedFiles });
  // Run the script
  // await labelledSpawn(
  //   "assets",
  //   // 'sucrase-node',
  //   "bun",
  //   "scripts/assets",
  //   `--changedFiles=${JSON.stringify(changedFiles)}`,
  // );

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
