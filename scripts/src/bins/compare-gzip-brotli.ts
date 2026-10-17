#!/usr/bin/env node

/**
 * Prints each file's size raw, gzipped and brotlied, at the levels a host would serve.
 * ```sh
 * pnpm compare-gzip-brotli packages/media/src/blockbench/current/current.glb
 * ```
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

/** Where it was run, as pnpm runs scripts from the repo root */
const cwd = process.env.INIT_CWD ?? process.cwd();
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: pnpm compare-gzip-brotli <file>...");
  process.exit(1);
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)}KB`;
const pct = (bytes: number, of: number) => `${Math.round((100 * bytes) / of)}%`;

for (const file of files) {
  const raw = readFileSync(resolve(cwd, file));
  const gzip = gzipSync(raw, { level: 9 }).length;
  const brotli = brotliCompressSync(raw, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length },
  }).length;
  console.log(
    `${file}\n  raw    ${kb(raw.length)}\n  gzip   ${kb(gzip)} (${pct(gzip, raw.length)})\n  brotli ${kb(brotli)} (${pct(brotli, raw.length)})`,
  );
}
