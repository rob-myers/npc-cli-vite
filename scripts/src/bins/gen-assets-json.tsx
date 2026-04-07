#!/usr/bin/env node --import=tsx

/**
 * - `symbol` -- symbol key to geometry/metadata
 * - `flattened` -- symbol key to unwound symbols (includes hull symbols)
 * - `layout` -- symbol key to layouts (geomorphs)
 *
 * USAGE:
 * ```sh
 * pnpm gen-assets-json
 * pnpm gen-assets-json --changedFiles='["/path/to/.../public/symbol/console--051--0.4x0.6.json"]'
 * ```
 */
import fs, { writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { SymbolGraph, type SymbolGraphNode } from "@npc-cli/graph";
import { isHullSymbolImageKey } from "@npc-cli/media/starship-symbol";
import { MapEditSavedFileSchema } from "@npc-cli/ui__map-edit/editor.schema";
import { AssetsSchema, type AssetsType } from "@npc-cli/ui__world/assets.schema";
import {
  createLayout,
  createMapDefFromSavedFile,
  createSymbolFromSavedFile,
  flattenSymbol,
} from "@npc-cli/ui__world/geomorph";
import { jsonParser } from "@npc-cli/util/json-parser";
import { entries, error, hashJson, info, safeJsonCompact, warn } from "@npc-cli/util/legacy/generic";
import z from "zod";
import { PROJECT_ROOT } from "../const";
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

perf("total");
info(`[gen-assets-json]`, `changedFiles: ${safeJsonCompact(changedFiles.map((f) => path.basename(f)))}`);

const assetsJsonPath = path.resolve("packages/app/public", "assets.json");
const prevAssetsRaw = await fs.promises.readFile(assetsJsonPath, "utf-8").catch(warn);
// we ignore parse errors as we extend AssetsSchema
const assets: AssetsType = jsonParser.pipe(AssetsSchema).safeParse(prevAssetsRaw).data ?? {
  map: {},
  symbol: {},
  flattened: {},
  stratifiedSymbolNodes: [],
  layout: {},
  hash: { obstacles: 0 },
};

perf("symbols/maps");
updateChangedSymbolsAndMaps(changedFiles, assets);
perf("symbols/maps");

perf("stratify symbols");
const symbolGraph = SymbolGraph.from(assets.symbol);
assets.stratifiedSymbolNodes = symbolGraph.stratify();
perf("stratify symbols");

perf("flatten symbols");
flattenSymbols(assets.stratifiedSymbolNodes, assets);
perf("flatten symbols");

perf("create layouts");
createLayouts(assets);
perf("create layouts");

assets.hash = {
  obstacles: hashJson(
    Object.values(assets.symbol).map((s) => s?.obstacles),
  ),
};

perf("total");

// reparse via z.encode ensures key-ordering
const nextAssetsRaw = safeJsonCompact(z.encode(AssetsSchema, assets));

if (prevAssetsRaw === nextAssetsRaw) {
  info(`${path.basename(import.meta.filename)}: no changes detected`);
  process.exit(0);
}

info(`${path.basename(import.meta.filename)}: detected changes`);
writeFileSync(assetsJsonPath, nextAssetsRaw);

function updateChangedSymbolsAndMaps(changedFiles: string[], assets: AssetsType) {
  for (const file of changedFiles) {
    const symRes = jsonParser.pipe(MapEditSavedFileSchema).safeParse(fs.readFileSync(file, "utf-8"));
    if (!symRes.success) {
      error(`${path.basename(file)}: skipping invalid MapEditSavedFile`);
      continue;
    }

    const savedFile = symRes.data;
    if (savedFile.type === "symbol") {
      const symbol = createSymbolFromSavedFile(savedFile);
      assets.symbol[symbol.key] = symbol;
    } else {
      const mapDef = createMapDefFromSavedFile(savedFile);
      assets.map[mapDef.key] = mapDef;
    }
  }
}

function flattenSymbols(symbolsStratified: SymbolGraphNode[][], assets: AssetsType) {
  const flattened: AssetsType["flattened"] = {};
  for (const level of symbolsStratified) {
    for (const { id: symbolKey } of level) {
      const symbol = assets.symbol[symbolKey];
      if (symbol) {
        flattenSymbol(symbol, flattened);
      } else {
        warn(`Symbol ${symbolKey} not found in assets.symbol`);
      }
    }
  }
  assets.flattened = flattened;
}

function createLayouts(assets: AssetsType) {
  for (const [symbolKey, flat] of entries(assets.flattened)) {
    if (!isHullSymbolImageKey(symbolKey)) continue;
    const layout = createLayout(symbolKey, flat, assets);
    assets.layout[symbolKey] = layout;
  }
}
