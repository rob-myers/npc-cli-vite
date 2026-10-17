#!/usr/bin/env node

/**
 * Writes `current.glb` from `current.gltf`: binary, deduped, resampled and pruned. Production loads it.
 * Run on each change of the gltf by the dev server, and on commit of one by the pre-commit hook.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path/posix";
import { gzipSync } from "node:zlib";
import { NodeIO, VertexLayout } from "@gltf-transform/core";
import { dedup, prune, resample } from "@gltf-transform/functions";
import { PROJECT_ROOT } from "../const.ts";

const dir = join(PROJECT_ROOT, "packages/media/src/blockbench/current");
const gltfPath = join(dir, "current.gltf");
const glbPath = join(dir, "current.glb");

/** Separate attributes, as the gltf has: three cannot merge an interleaved one with the label quad's */
const io = new NodeIO().setVertexLayout(VertexLayout.SEPARATE);
const doc = await io.read(gltfPath);
await doc.transform(dedup(), resample(), prune());
const glb = Buffer.from(await io.writeBinary(doc));

/** Only a changed glb is written, so neither the watcher nor the hook makes a spurious diff */
const prev = (() => {
  try {
    return readFileSync(glbPath);
  } catch {
    return null;
  }
})();

const gltf = readFileSync(gltfPath);
const kb = (buf: Buffer) => `${Math.round(buf.length / 1024)}KB (${Math.round(gzipSync(buf).length / 1024)}KB gzipped)`;
if (prev?.equals(glb)) {
  console.log(`[gen-current-glb] current.glb unchanged: ${kb(glb)}`);
} else {
  writeFileSync(glbPath, glb);
  console.log(`[gen-current-glb] wrote current.glb: ${kb(gltf)} to ${kb(glb)}`);
}
