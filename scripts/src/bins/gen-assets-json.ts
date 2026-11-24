#!/usr/bin/env node --import=tsx

/**
 * - `assets.json` -- maps, and a hash per layout file
 * - `assets-edit.json` -- symbols, flattened symbols and their stratification
 * - `layout/{gmKey}.json` -- one layout per geomorph
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
import fs, { writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { SymbolGraph } from "@npc-cli/graph";
import { isHullSymbolImageKey } from "@npc-cli/media/starship-symbol";
import { MapEditSavedFileSchema } from "@npc-cli/ui__map-edit/editor.schema";
import { AssetsSchema, type AssetsType } from "@npc-cli/ui__world/assets.schema";
import {
  createLayout,
  createMapDefFromSavedFile,
  flattenSymbols,
  parseSymbolFromSavedFile,
} from "@npc-cli/ui__world/geomorph";
import { jsonParser } from "@npc-cli/util/json-parser";
import { entries, error, hashJson, hashText, info, safeJsonCompact, warn } from "@npc-cli/util/legacy/generic";
import z from "zod";
import { PROJECT_ROOT } from "../const";
import { perf } from "../service/performance";
import { assetsPaths, readAssetsRaw } from "../service/read-assets";

const opts = parseArgs({
  args: process.argv.slice(2),
  options: { changedFiles: { type: "string" }, force: { type: "boolean" } },
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

perf("total");
info(`[gen-assets-json]`, `changedFiles: ${safeJsonCompact(changedFiles.map((f) => path.basename(f)))}`);

const assetsJsonPath = assetsPaths.index;
const publicDir = path.dirname(assetsJsonPath);
const hasPrev = [assetsPaths.index, assetsPaths.edit].every((file) => fs.existsSync(file));
if (!hasPrev) warn("[gen-assets-json] no previous assets: starting afresh");
// we ignore parse errors as we extend AssetsSchema
const assets: AssetsType = AssetsSchema.safeParse(hasPrev ? readAssetsRaw() : null).data ?? {
  map: {},
  symbol: {},
  flattened: {},
  stratifiedSymbolNodes: [],
  layout: {},
  hash: { obstacles: 0 },
};

const changedSymbolKeys = changedFiles.map((f) => path.basename(f, ".json"));

perf("symbols/maps");
updateChangedSymbolsAndMaps(changedFiles, assets);
perf("symbols/maps");

perf("stratify symbols");
// always: a symbol given a new sub-symbol moves up a level, though none was created
assets.stratifiedSymbolNodes = SymbolGraph.from(assets.symbol).stratify();
perf("stratify symbols");

// 🔔 avoid needless updates
const stratifiedStartIndex = opts.values.force
  ? 0
  : assets.stratifiedSymbolNodes.findIndex((level) => level.some(({ id }) => changedSymbolKeys.includes(id)));

perf("flatten symbols");
flattenSymbols(stratifiedStartIndex === -1 ? [] : assets.stratifiedSymbolNodes.slice(stratifiedStartIndex), assets);
perf("flatten symbols");

perf("create layouts");
createLayouts(assets);
perf("create layouts");

assets.hash = {
  obstacles: hashJson(Object.values(assets.symbol).map((s) => s?.obstacles)),
};

perf("total");

/** Decimal places a layout keeps: 0.01 mm */
const layoutDecimals = 5;

// reparse via z.encode ensures key-ordering
const encoded = z.encode(AssetsSchema, assets);
const { symbol, flattened, stratifiedSymbolNodes, layout, map, hash } = encoded;
const layoutRaws = entries(layout).map(([gmKey, l]) => [gmKey, safeJsonCompact(roundNumbers(l))] as const);
const layoutFiles = layoutRaws.map(([gmKey, raw]) => [assetsPaths.layout(gmKey), raw] as const);
const staleLayoutFiles = fs
  .globSync(path.join(assetsPaths.layoutDir, "*.json"))
  .filter((file) => !layoutFiles.some(([f]) => f === file));
const index = {
  // by key, so a map renamed and back leaves the index as it was
  map: Object.fromEntries(entries(map).sort(([a], [b]) => (a < b ? -1 : 1))),
  hash: { ...hash, layout: Object.fromEntries(layoutRaws.map(([k, raw]) => [k, hashText(raw)])) },
};

fs.mkdirSync(assetsPaths.layoutDir, { recursive: true });
const written = [
  [assetsJsonPath, safeJsonCompact(index)] as const,
  [assetsPaths.edit, safeJsonCompact({ symbol, flattened, stratifiedSymbolNodes })] as const,
  ...layoutFiles,
].filter(([file, raw]) => writeIfChanged(file, raw));
staleLayoutFiles.forEach((file) => fs.rmSync(file));

const namesOf = (files: string[]) => files.map((f) => path.relative(publicDir, f)).join(", ");
const changes = [
  written.length > 0 && `wrote ${namesOf(written.map(([f]) => f))}`,
  staleLayoutFiles.length > 0 && `removed ${namesOf(staleLayoutFiles)}`,
].filter(Boolean);
info(`${path.basename(import.meta.filename)}: ${changes.join("; ") || "no changes detected"}`);

/** `value` with each non-integer rounded to `layoutDecimals` places, so float noise e.g. `12.649999999999999` never reaches a diff */
function roundNumbers<T>(value: T): T {
  if (typeof value === "number") return (Number.isInteger(value) ? value : +value.toFixed(layoutDecimals)) as T;
  if (Array.isArray(value)) return value.map(roundNumbers) as T;
  if (value !== null && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundNumbers(v)])) as T;
  return value;
}

/** Writes `raw` unless the file already holds it */
function writeIfChanged(file: string, raw: string) {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf-8") === raw) return false;
  writeFileSync(file, raw);
  return true;
}

function updateChangedSymbolsAndMaps(changedFiles: string[], assets: AssetsType) {
  for (const file of changedFiles) {
    const symRes = jsonParser.pipe(MapEditSavedFileSchema).safeParse(fs.readFileSync(file, "utf-8"));
    if (!symRes.success) {
      error(`${path.basename(file)}: skipping invalid MapEditSavedFile`);
      continue;
    }

    const savedFile = symRes.data;
    if (savedFile.type === "symbol") {
      const symbol = parseSymbolFromSavedFile(savedFile);
      assets.symbol[symbol.key] = symbol;
    } else {
      const mapDef = createMapDefFromSavedFile(savedFile);
      assets.map[mapDef.key] = mapDef;
    }
  }
}

function createLayouts(assets: AssetsType) {
  for (const [symbolKey, flat] of entries(assets.flattened)) {
    if (!isHullSymbolImageKey(symbolKey)) continue;
    const layout = createLayout(symbolKey, flat, assets);
    assets.layout[symbolKey] = layout;
  }
}
