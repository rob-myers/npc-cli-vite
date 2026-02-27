#!/usr/bin/env node --import=tsx

// USAGE:
// pnpm process-symbols --changedFiles='["packages/app/public/symbol/untitled.json"]'

import { info, safeJsonParse } from "@npc-cli/util/legacy/generic";
//@ts-expect-error
import getopts from "getopts";

const opts = getopts(process.argv, { string: ["changedFiles"] });
const changedFiles = safeJsonParse(opts.changedFiles) as string[];
if (!Array.isArray(changedFiles) || !changedFiles.every((file) => typeof file === "string")) {
  throw new Error("Invalid value for --changedFiles. Expected a JSON array of strings.");
}

info("🚧 process-symbols", JSON.stringify(changedFiles));

// for (const file of changedFiles) {
//   const contents = readFileSync(file).toString();
//   info("🚧", file, contents);
// }
