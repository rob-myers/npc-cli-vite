#!/usr/bin/env node --import=tsx

/**
 * Writes `public/spot/{gmKey}.json` per hull geomorph in `assets.json`, bar playgrounds — see `docs/spots.md`.
 * A geomorph whose layout and spot code are unchanged is skipped. Several are made at once, a process each.
 *
 * USAGE:
 * ```sh
 * pnpm gen-spots
 * pnpm gen-spots --gmKeys='["g-101--multipurpose"]'
 * pnpm gen-spots --force
 * ```
 */
import childProcess from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { isPlaygroundSymbolKey } from "@npc-cli/ui__map-edit/editor.schema";
import { AssetsSchema } from "@npc-cli/ui__world/assets.schema";
import { type SpotsFile, SpotsFileSchema } from "@npc-cli/ui__world/spot.schema";
import { computeSpots, createGmNavMesh, spotConfig } from "@npc-cli/ui__world/spots";
import { jsonParser } from "@npc-cli/util/json-parser";
import { hashJson, hashText, info } from "@npc-cli/util/legacy/generic";
import z from "zod";
import { PROJECT_ROOT } from "../const";

const opts = parseArgs({
  args: process.argv.slice(2),
  options: { gmKeys: { type: "string" }, force: { type: "boolean" } },
});
const onlyGmKeys = jsonParser.pipe(z.array(z.string())).safeParse(opts.values.gmKeys).data;

const publicDir = path.resolve(PROJECT_ROOT, "packages/app/public");
const spotDir = path.resolve(publicDir, "spot");
const worldSrc = path.resolve(PROJECT_ROOT, "packages/ui/world/src");
/** Code that makes them: edited, every geomorph's are made again */
const codeHash = hashText(
  ["spots.ts", "spot-sight.ts", "seg-grid.ts"]
    .map((name) => fs.readFileSync(path.resolve(worldSrc, "service", name), "utf-8"))
    .join("\n"),
);

const raw = JSON.parse(fs.readFileSync(path.resolve(publicDir, "assets.json"), "utf-8"));
const assets = AssetsSchema.parse(raw);
fs.mkdirSync(spotDir, { recursive: true });

/** Geomorphs whose layout or spot code changed, unless forced */
const todo = Object.values(assets.layout).flatMap((layout) => {
  if (layout === undefined || (onlyGmKeys !== undefined && !onlyGmKeys.includes(layout.key))) return [];
  if (isPlaygroundSymbolKey(layout.key)) return []; // edited at runtime: spots do not follow
  const file = path.resolve(spotDir, `${layout.key}.json`);
  const layoutHash = hashJson([raw.layout[layout.key], codeHash], false);
  const prev = fs.existsSync(file)
    ? SpotsFileSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf-8"))).data
    : undefined;
  return opts.values.force !== true && prev?.layoutHash === layoutHash ? [] : [{ layout, file, layoutHash }];
});

const startMs = performance.now();
if (todo.length > 1) {
  // a child process each, as many at once as there are cores: each is independent
  const queue = todo.map(({ layout }) => layout.key);
  const runOne = async (): Promise<void> => {
    const gmKey = queue.shift();
    if (gmKey === undefined) return;
    await new Promise<void>((resolve, reject) => {
      const args = [
        ...process.execArgv,
        fileURLToPath(import.meta.url),
        `--gmKeys=${JSON.stringify([gmKey])}`,
        "--force",
      ];
      const proc = childProcess.spawn(process.execPath, args, { stdio: "inherit" });
      proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${gmKey}: exit code ${code}`))));
      proc.on("error", reject);
    });
    return runOne();
  };
  await Promise.all(Array.from({ length: Math.min(queue.length, os.availableParallelism()) }, runOne));
} else {
  for (const { layout, file, layoutHash } of todo) {
    const { spots, rooms, hull, regionRadius, coverage, ms } = computeSpots(layout, await createGmNavMesh(layout));
    const out: SpotsFile = {
      gmKey: layout.key,
      layoutHash,
      angles: spotConfig.angles,
      radius: spotConfig.radius,
      regionRadius,
      rooms,
      hull,
      spots,
    };
    // a spot a line: compact, and a diff shows which changed
    const { spots: _, ...head } = out;
    const text = `${JSON.stringify(head).slice(0, -1)},"spots":[\n${spots.map((x) => JSON.stringify(x)).join(",\n")}\n]}\n`;
    // renamed into place, so a fetch meanwhile reads the old file or the new, never half of one
    fs.writeFileSync(`${file}.tmp`, text);
    fs.renameSync(`${file}.tmp`, file);
    const parts = Object.entries(ms).map(([part, partMs]) => `${part} ${Math.round(partMs)}`);
    info(
      "[gen-spots]",
      `${layout.key}: ${spots.length} spots, ${Math.round(text.length / 1024)}KB, coverage ${coverage.toFixed(2)}m,`,
      `${Math.round(performance.now() - startMs)}ms (${parts.join(", ")})`,
    );
  }
}
if (todo.length !== 1 || onlyGmKeys === undefined) {
  info("[gen-spots]", `${todo.length} made in ${Math.round(performance.now() - startMs)}ms`);
}
