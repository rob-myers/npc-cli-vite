#!/usr/bin/env node --import=tsx

/**
 * Writes `public/spot/{gmKey}.json` per hull geomorph in `assets.json` — see `docs/spots.md`.
 * A geomorph whose layout and spot code are unchanged is skipped.
 *
 * USAGE:
 * ```sh
 * pnpm gen-spots
 * pnpm gen-spots --gmKeys='["g-101--multipurpose"]'
 * pnpm gen-spots --force
 * ```
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
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
const codeHash = hashText(fs.readFileSync(path.resolve(worldSrc, "service/spots.ts"), "utf-8"));

const raw = JSON.parse(fs.readFileSync(path.resolve(publicDir, "assets.json"), "utf-8"));
const assets = AssetsSchema.parse(raw);
fs.mkdirSync(spotDir, { recursive: true });

for (const layout of Object.values(assets.layout)) {
  if (layout === undefined || (onlyGmKeys !== undefined && !onlyGmKeys.includes(layout.key))) continue;
  const file = path.resolve(spotDir, `${layout.key}.json`);
  const layoutHash = hashJson([raw.layout[layout.key], codeHash], false);
  const prev = fs.existsSync(file)
    ? SpotsFileSchema.safeParse(JSON.parse(fs.readFileSync(file, "utf-8"))).data
    : undefined;
  if (opts.values.force !== true && prev?.layoutHash === layoutHash) continue;

  const startMs = performance.now();
  const spots = computeSpots(layout, await createGmNavMesh(layout));
  const out: SpotsFile = {
    gmKey: layout.key,
    layoutHash,
    angles: spotConfig.angles,
    radius: spotConfig.radius,
    spots,
  };
  // a spot a line: compact, and a diff shows which changed
  const { spots: _, ...head } = out;
  fs.writeFileSync(
    file,
    `${JSON.stringify(head).slice(0, -1)},"spots":[\n${spots.map((x) => JSON.stringify(x)).join(",\n")}\n]}\n`,
  );
  info("[gen-spots]", `${layout.key}: ${spots.length} spots in ${Math.round(performance.now() - startMs)}ms`);
}
