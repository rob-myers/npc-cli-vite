import fs, { readFileSync } from "node:fs";
import path from "node:path";
import { isHullSymbolImageKey } from "@npc-cli/media/starship-symbol";
import {
  type ImageMapNode,
  type MapEditFileSpecifier,
  MapEditMapFileSpecifierSchema,
  type MapEditSavedFile,
  MapEditSavedFileSchema,
  MapEditSymbolFileSpecifierSchema,
  MapsManifestItemSchema,
  MapsManifestSchema,
  type SymbolMapNode,
  SymbolsManifestItemSchema,
  SymbolsManifestSchema,
} from "@npc-cli/ui__map-edit/editor.schema";
import { isNodeTransformable, migrateMapEditSavedFile, traverseNodesAsync } from "@npc-cli/ui__map-edit/map-node-api";
import { geomService, Mat, Rect } from "@npc-cli/util/geom";
import { jsonParser } from "@npc-cli/util/json-parser";
import { deepClone, error, info, safeJsonCompact, warn } from "@npc-cli/util/legacy/generic";
import { drawPolygons } from "@npc-cli/util/service/canvas";
import { Canvas, loadImage } from "skia-canvas";
import z from "zod";
import { PROJECT_ROOT } from "../const.ts";

export async function deleteSavedFile(fileSpecifier: MapEditFileSpecifier) {
  await ensureManifests(fileSpecifier.type, { changedFiles: [], removedFiles: [fileSpecifier] });
}

function getImageOrSymbolNodeImageUrl(node: ImageMapNode | SymbolMapNode, isMap: boolean) {
  return isMap // avoid large map thumbnails
    ? path.resolve(PROJECT_ROOT, "packages/app/public/symbol", `${node.srcKey}.thumbnail.png`)
    : node.type === "image" && node.srcType === "decor"
      ? path.resolve(PROJECT_ROOT, "packages/app/public/decor", `${node.srcKey}.svg`)
      : path.resolve(PROJECT_ROOT, "packages/app/public/starship-symbol", `${node.srcKey}.png`);
}

/**
 * - Expects text
 * - Applies `migrateMapEditSavedFile` to parsed json before `MapEditSavedFileSchema.parse`
 */
export function parseRawMapEditFile(rawFileString: string) {
  return jsonParser.pipe(z.preprocess(migrateMapEditSavedFile, MapEditSavedFileSchema)).parse(rawFileString);
}

export async function processSavedFile(savedFile: MapEditSavedFile) {
  await createSavedFilePreviewPng(savedFile);

  // ensure both manifests
  await ensureManifests("symbol", {
    changedFiles: [savedFile].filter((x) => x.type === "symbol"),
  });
  await ensureManifests("map", { changedFiles: [savedFile].filter((x) => x.type === "map") });
}

async function createSavedFilePreviewPng(savedFile: MapEditSavedFile) {
  const isMap = savedFile.type === "map";
  const isHullSymbol = savedFile.type === "symbol" && isHullSymbolImageKey(savedFile.key);
  const { filename, nodes, bounds } = savedFile;

  // Scale down hull symbols rather than up
  const scale = 2;
  const integralBounds = Rect.fromJson(bounds).integerOrds();
  const canvas = new Canvas(integralBounds.width * scale, integralBounds.height * scale);
  const ct = canvas.getContext("2d");

  await traverseNodesAsync(nodes, async (node) => {
    if (!isNodeTransformable(node)) return;

    // transform about top-left
    const [a, b, c, d, tx, ty] = new Mat(node.cssTransform).toArray();
    ct.setTransform(scale, 0, 0, scale, 0, 0);
    ct.translate(tx - bounds.x, ty - bounds.y);
    ct.transform(a, b, c, d, 0, 0);

    switch (node.type) {
      case "image":
      case "symbol": {
        if (isHullSymbol) break; // avoid large hull thumbnails
        const image = await loadImage(getImageOrSymbolNodeImageUrl(node, isMap));

        if (node.type === "image") ct.globalAlpha = node.locked ? 0.2 : 1;
        ct.drawImage(image, 0, 0, node.baseRect.width, node.baseRect.height);
        ct.globalAlpha = 1;
        if (node.type === "symbol") {
          ct.strokeStyle = "rgba(0,255,0,0.5)";
          ct.strokeRect(0, 0, node.baseRect.width, node.baseRect.height);
        }

        break;
      }
      case "rect": {
        ct.fillStyle = "rgba(0,255,0,0.2)";
        ct.fillRect(0, 0, node.baseRect.width, node.baseRect.height);
        break;
      }
      case "path": {
        ct.strokeStyle = isHullSymbol ? "rgba(0,0,0,0)" : "rgba(0,0,0,1)";
        ct.fillStyle = "rgba(255,255,0,1)";
        const parsedPoly = geomService.svgPathToPolygon(node.d);
        if (!parsedPoly) {
          warn(`${filename}: failed to parse path.d data for node ${node.name}`);
          break;
        }
        drawPolygons(ct as unknown as CanvasRenderingContext2D, parsedPoly);
        break;
      }
    }
  });

  if (canvas.width === 0 || canvas.height === 0) {
    warn(`Skipping thumbnail generation for ${filename} due to zero width or height`);
    return;
  }

  if (isHullSymbol) {
    ct.resetTransform();
    ct.font = "100px sans-serif";
    const rect = ct.measureText(savedFile.key);
    ct.fillText(savedFile.key, (canvas.width - rect.width) / 2, (canvas.height + 32) / 2);
  }

  await canvas.toFile(
    path.resolve(
      PROJECT_ROOT,
      `packages/app/public/${savedFile.type}`,
      `${path.basename(filename, ".json")}.thumbnail.png`,
    ),
  );
}

type ProcessFileOpts = {
  changedFiles?: MapEditSavedFile[];
  removedFiles?: MapEditFileSpecifier[];
};

/**
 * - if `changedFiles` undefined then regenerate all
 * - otherwise ensure `changedFiles` and also missing files
 */
async function ensureManifests(type: "symbol" | "map", opts: ProcessFileOpts) {
  const schema =
    type === "symbol"
      ? ({
          manifest: SymbolsManifestSchema,
          entryManifest: SymbolsManifestItemSchema,
          fileSpecifier: MapEditSymbolFileSpecifierSchema,
        } as const)
      : ({
          manifest: MapsManifestSchema,
          entryManifest: MapsManifestItemSchema,
          fileSpecifier: MapEditMapFileSpecifierSchema,
        } as const);

  const PUBLIC_SUB_DIRECTORY = path.resolve(PROJECT_ROOT, `packages/app/public/${type}`);
  const manifestPath = path.resolve(PUBLIC_SUB_DIRECTORY, "manifest.json");

  const prevManifest = jsonParser
    .pipe(schema.manifest)
    .safeParse(await fs.promises.readFile(manifestPath, "utf-8").catch(warn)).data;
  // mutate existing if possible
  const byKey = deepClone(prevManifest?.byKey ?? {});

  // Must exclude manifest.json
  const itemFilePaths = fs
    .globSync(path.resolve(PUBLIC_SUB_DIRECTORY, "*.json"))
    .filter((filePath) => filePath !== manifestPath);
  const changedFilenames =
    opts.changedFiles?.map((x) => x.filename) ?? itemFilePaths.map((filePath) => path.basename(filePath));

  for (const filePath of itemFilePaths) {
    const filename = path.basename(filePath);
    const key = path.basename(filename, ".json") as keyof typeof byKey;
    const fileSpecifierResult = schema.fileSpecifier.safeParse({ type, key, filename });

    if (!fileSpecifierResult.success) {
      warn(`Skipping invalid "${filename}" in directory "${type}"`);
      continue;
    }

    if (!byKey[key] || changedFilenames.includes(filename)) {
      const savedFileResult = jsonParser.pipe(MapEditSavedFileSchema).safeParse(readFileSync(filePath, "utf-8"));
      if (savedFileResult.success) {
        // must re-parse to ensure key-order for JSON.stringify equality-test
        byKey[key] = schema.entryManifest.parse({
          ...fileSpecifierResult.data,
          thumbnailFilename: `${path.basename(filename, ".json")}.thumbnail.png`,
          width: savedFileResult.data.width,
          height: savedFileResult.data.height,
          bounds: savedFileResult.data.bounds,
        });
      } else {
        error(`Failed to parse existing ${type}: ${filename}`, z.prettifyError(savedFileResult.error));
      }
    }

    if (opts.removedFiles?.some((x) => x.filename === filename)) {
      const entry = byKey[key];
      if (entry) {
        delete byKey[key];
        await fs.promises.unlink(path.resolve(PUBLIC_SUB_DIRECTORY, entry.filename)).catch(warn);
        await fs.promises.unlink(path.resolve(PUBLIC_SUB_DIRECTORY, entry.thumbnailFilename)).catch(warn);
      } else {
        error(`Failed to remove ${type}: ${filename} (no entry in manifest)`);
      }
    }
  }

  const prevManifestRaw = safeJsonCompact(prevManifest);
  const nextManifestRaw = safeJsonCompact(z.decode(schema.manifest, { byKey }));

  if (prevManifestRaw === nextManifestRaw) {
    info(`${path.basename(import.meta.filename)}: ${type}: no changes detected`);
    return;
  }

  info(`${path.basename(import.meta.filename)}: ${type}: changes detected`);
  fs.writeFileSync(manifestPath, nextManifestRaw);
}
