import fs from "node:fs";
import path from "node:path";
import { type AssetsEncodedType, AssetsSchema, type AssetsType } from "@npc-cli/ui__world/assets.schema";
import { PROJECT_ROOT } from "../const.ts";

const publicDir = path.resolve(PROJECT_ROOT, "packages/app/public");

/** Where `gen-assets-json` writes its files */
export const assetsPaths = {
  index: path.resolve(publicDir, "assets.json"),
  edit: path.resolve(publicDir, "assets-edit.json"),
  layoutDir: path.resolve(publicDir, "layout"),
  layout: (gmKey: string) => path.resolve(publicDir, "layout", `${gmKey}.json`),
};

/** The split files reassembled, still encoded. Throws if one is missing. */
export function readAssetsRaw(): AssetsEncodedType {
  const { map, hash } = readJson(assetsPaths.index);
  const { symbol, flattened, stratifiedSymbolNodes } = readJson(assetsPaths.edit);
  const layout = readLayoutsRaw();
  return { symbol, map, flattened, stratifiedSymbolNodes, layout, hash };
}

/** Every `layout/{gmKey}.json`, still encoded */
export function readLayoutsRaw(): AssetsEncodedType["layout"] {
  return Object.fromEntries(
    fs
      .globSync(path.join(assetsPaths.layoutDir, "*.json"))
      .map((file) => [path.basename(file, ".json"), readJson(file)]),
  );
}

export function readAssets(): AssetsType {
  return AssetsSchema.parse(readAssetsRaw());
}

function readJson(file: string) {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}
