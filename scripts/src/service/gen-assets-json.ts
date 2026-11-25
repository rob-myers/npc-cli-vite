import fs, { writeFileSync } from "node:fs";
import path from "node:path";
import { SymbolGraph } from "@npc-cli/graph";
import { isHullSymbolImageKey } from "@npc-cli/media/starship-symbol";
import { MapEditSavedFileSchema } from "@npc-cli/ui__map-edit/editor.schema";
import { AssetsSchema, type AssetsType, GeomorphLayoutSchema } from "@npc-cli/ui__world/assets.schema";
import {
  createLayout,
  createMapDefFromSavedFile,
  flattenSymbols,
  parseSymbolFromSavedFile,
} from "@npc-cli/ui__world/geomorph";
import { jsonParser } from "@npc-cli/util/json-parser";
import { entries, error, hashJson, hashText, info, safeJsonCompact, warn } from "@npc-cli/util/legacy/generic";
import prettyCompact from "json-stringify-pretty-compact";
import z from "zod";
import { PROJECT_ROOT } from "../const";
import { perf } from "./performance";
import { assetsPaths, readAssetsRaw } from "./read-assets";

/** Each hull's last layout, by gmKey, with a hash of what it was made from and its file's text — see `layoutInputHash` */
type LayoutCache = Map<string, { inputHash: number; layout: ReturnType<typeof createLayout>; raw?: string }>;

/**
 * Writes `assets.json`, `assets-edit.json` and `layout/{gmKey}.json` from `public/symbol` and `public/map`.
 * A hull whose inputs are unchanged keeps its layout, whilst this module is loaded — see `layoutCache`.
 */
export function genAssetsJson({
  changedFiles: inputChangedFiles,
  force = false,
  fresh = false,
}: {
  changedFiles?: string[];
  /** Recompute stratification */
  force?: boolean;
  /** Make every layout again, e.g. the WorldMenu's assets button */
  fresh?: boolean;
} = {}) {
  if (fresh) layoutCache.clear();
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
  const stratifiedStartIndex = force
    ? 0
    : assets.stratifiedSymbolNodes.findIndex((level) => level.some(({ id }) => changedSymbolKeys.includes(id)));

  perf("flatten symbols");
  flattenSymbols(stratifiedStartIndex === -1 ? [] : assets.stratifiedSymbolNodes.slice(stratifiedStartIndex), assets);
  perf("flatten symbols");

  perf("create layouts");
  const reused = createLayouts(assets, layoutCache);
  perf("create layouts");

  assets.hash = {
    obstacles: hashJson(Object.values(assets.symbol).map((s) => s?.obstacles)),
  };

  perf("total");

  // reparse via z.encode ensures key-ordering. It is plain JSON, so `prettyCompact` alone will do
  // layouts are encoded one by one, so a kept one keeps its text
  const encoded = z.encode(AssetsSchema, { ...assets, layout: {} });
  const { symbol, flattened, stratifiedSymbolNodes, map, hash } = encoded;
  const layoutRaws = entries(assets.layout).flatMap(([gmKey, l]) =>
    l === undefined ? [] : [[gmKey, layoutRawOf(gmKey, l, layoutCache)] as const],
  );
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
    [assetsJsonPath, prettyCompact(index)] as const,
    [assetsPaths.edit, prettyCompact({ symbol, flattened, stratifiedSymbolNodes })] as const,
    ...layoutFiles,
  ].filter(([file, raw]) => writeIfChanged(file, raw));
  staleLayoutFiles.forEach((file) => fs.rmSync(file));

  const namesOf = (files: string[]) => files.map((f) => path.relative(publicDir, f)).join(", ");
  const changes = [
    written.length > 0 && `wrote ${namesOf(written.map(([f]) => f))}`,
    staleLayoutFiles.length > 0 && `removed ${namesOf(staleLayoutFiles)}`,
    reused.length > 0 && `kept layouts of ${reused.join(", ")}`,
  ].filter(Boolean);
  info(`gen-assets-json: ${changes.join("; ") || "no changes detected"}`);
}

/** Makes each hull's layout, else keeps its cached one if made from the same. Returns the gmKeys kept */
function createLayouts(assets: AssetsType, cache?: LayoutCache) {
  const reused: string[] = [];
  for (const [symbolKey, flat] of entries(assets.flattened)) {
    if (!isHullSymbolImageKey(symbolKey)) continue;
    const inputHash = cache === undefined ? 0 : layoutInputHash(symbolKey, flat, assets);
    const cached = cache?.get(symbolKey);
    if (cached !== undefined && cached.inputHash === inputHash) {
      assets.layout[symbolKey] = cached.layout;
      reused.push(symbolKey);
      continue;
    }
    const layout = createLayout(symbolKey, flat, assets);
    assets.layout[symbolKey] = layout;
    cache?.set(symbolKey, { inputHash, layout });
  }
  return reused;
}

/** A layout's file text: a kept layout's from the cache, else encoded, rounded and pretty-printed */
function layoutRawOf(gmKey: string, layout: ReturnType<typeof createLayout>, cache?: LayoutCache) {
  const cached = cache?.get(gmKey);
  if (cached?.layout === layout && cached.raw !== undefined) return cached.raw;
  const raw = prettyCompact(roundNumbers(z.encode(GeomorphLayoutSchema, layout)));
  if (cached?.layout === layout) cached.raw = raw;
  return raw;
}

/** A hash of what `createLayout` reads: the hull's flat symbol, its own symbol, and each inner symbol's obstacles */
function layoutInputHash(...[gmKey, flat, assets]: Parameters<typeof createLayout>) {
  const symKeys = [...new Set(flat.obstacles.map((o) => o.meta.symKey as keyof AssetsType["symbol"]))].sort();
  return hashJson([flat, assets.symbol[gmKey], symKeys.map((key) => assets.symbol[key]?.obstacles)], false);
}

/** `value` with each non-integer rounded to `layoutDecimals` places, so float noise e.g. `12.649999999999999` never reaches a diff */
function roundNumbers<T>(value: T): T {
  if (typeof value === "number") return (Number.isInteger(value) ? value : +value.toFixed(layoutDecimals)) as T;
  if (Array.isArray(value)) return value.map(roundNumbers) as T;
  if (value !== null && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, roundNumbers(v)])) as T;
  return value;
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

/** Writes `raw` unless the file already holds it */
function writeIfChanged(file: string, raw: string) {
  if (fs.existsSync(file) && fs.readFileSync(file, "utf-8") === raw) return false;
  writeFileSync(file, raw);
  return true;
}

/** Decimal places a layout keeps: 0.01 mm */
const layoutDecimals = 5;

/** Kept whilst this module is: a reload of it, or of anything it imports, starts afresh */
const layoutCache: LayoutCache = new Map();
