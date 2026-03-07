import fs, { readFileSync } from "node:fs";
import path from "node:path";
import { isHullSymbolImageKey } from "@npc-cli/media/starship-symbol";
// must import type, use cache-busting import for values
import type {
  MapEditFileSpecifier,
  MapEditSavedFile,
} from "@npc-cli/ui__map-edit/map-node-api";
import { Mat, Rect } from "@npc-cli/util/geom";
import { jsonParser } from "@npc-cli/util/json-parser";
import { error, warn } from "@npc-cli/util/legacy/generic";
import { Canvas, loadImage } from "skia-canvas";
import z from "zod";
import { PROJECT_ROOT } from "../const.ts";

// ⚠️ fix stale schemas via cache busting
const {
  MapEditSavedFileSchema,
  MapsManifestSchema,
  SymbolsManifestSchema,
  traverseNodesAsync,
  SymbolJsonFilenameSchema,
  MapJsonFilenameSchema,
  MapEditFileSpecifierSchema,
  isNodeTransformable,
  migrateMapEditSavedFile,
} = (await import(
  `../../../packages/ui/map-edit/src/map-node-api.ts?t=${Date.now()}`
)) as typeof import("@npc-cli/ui__map-edit/map-node-api");

export async function deleteSavedFile(fileSpecifier: MapEditFileSpecifier) {
  await ensureManifests(fileSpecifier.type, { changedFiles: [], removedFiles: [fileSpecifier] });
}

export function parseRawMapEditFile(rawFileString: string) {
  return jsonParser.pipe(z.preprocess(migrateMapEditSavedFile, MapEditSavedFileSchema)).parse(rawFileString);
}

export function parseMapEditFileSpecifier(fileSpecifier: { type: MapEditSavedFile["type"]; filename: string }) {
  return MapEditFileSpecifierSchema.parse(fileSpecifier);
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
  const { filename, nodes, bounds } = savedFile;
  // Scale down hull symbols rather than up
  const scale = savedFile.type === "symbol" && isHullSymbolImageKey(savedFile.key) ? 0.5 : 2;
  const integralBounds = Rect.fromJson(bounds).integerOrds();
  const canvas = new Canvas(integralBounds.width * scale, integralBounds.height * scale);
  const ct = canvas.getContext("2d");

  await traverseNodesAsync(nodes, async (node) => {
    if (!isNodeTransformable(node)) return;

    ct.setTransform(scale, 0, 0, scale, 0, 0);
    ct.transform(...new Mat(node.cssTransform).toArray());
    ct.translate(-bounds.x, -bounds.y); // integralBounds?

    switch (node.type) {
      case "image": {
        const image = await loadImage(
          path.resolve(PROJECT_ROOT, "packages/app/public/starship-symbol", `${node.srcKey}.png`),
        );
        ct.drawImage(image, 0, 0, node.baseRect.width, node.baseRect.height);
        break;
      }
      case "rect": {
        ct.fillStyle = "rgba(0,255,0,0.2)";
        ct.fillRect(0, 0, node.baseRect.width, node.baseRect.height);
        break;
      }
    }
  });

  if (canvas.width === 0 || canvas.height === 0) {
    warn(`Skipping thumbnail generation for ${filename} due to zero width or height`);
    return;
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
      ? ({ manifest: SymbolsManifestSchema, filename: SymbolJsonFilenameSchema } as const)
      : ({ manifest: MapsManifestSchema, filename: MapJsonFilenameSchema } as const);

  const createdAt = new Date().toISOString();
  const directory = path.resolve(PROJECT_ROOT, `packages/app/public/${type}`);
  const manifestPath = path.resolve(directory, "manifest.json");
  const nextManifest = jsonParser
    .pipe(schema.manifest)
    .safeParse(await fs.promises.readFile(manifestPath, "utf-8").catch(warn)).data ?? { createdAt, byFilename: {} };
  type ManifestItemFilename = keyof typeof nextManifest.byFilename | "manifest.json";

  const filePaths = fs.globSync(path.resolve(directory, "*.json"));
  const changedFilenames =
    opts.changedFiles?.map((x) => x.filename) ?? filePaths.map((filePath) => path.basename(filePath));

  for (const filePath of filePaths) {
    const filename = path.basename(filePath) as ManifestItemFilename;
    if (filename === "manifest.json") continue;
    if (!schema.filename.safeParse(filename).success) {
      warn(`Skipping file "${filename}" with invalid name in directory "${type}"`);
      continue;
    }

    if (!nextManifest.byFilename[filename] || changedFilenames.includes(filename)) {
      const savedFileResult = jsonParser.pipe(MapEditSavedFileSchema).safeParse(readFileSync(filePath, "utf-8"));
      if (savedFileResult.success) {
        nextManifest.byFilename[filename] = {
          filename,
          thumbnailFilename: `${path.basename(filename, ".json")}.thumbnail.png`,
          width: savedFileResult.data.width,
          height: savedFileResult.data.height,
          bounds: savedFileResult.data.bounds,
        };
      } else {
        error(`Failed to parse existing ${type}: ${filename}`, z.prettifyError(savedFileResult.error));
      }
    }

    if (opts.removedFiles?.some((x) => x.filename === filename)) {
      const entry = nextManifest.byFilename[filename];
      if (entry) {
        delete nextManifest.byFilename[filename];
        await fs.promises.unlink(path.resolve(directory, entry.filename)).catch(warn);
        await fs.promises.unlink(path.resolve(directory, entry.thumbnailFilename)).catch(warn);
      } else {
        error(`Failed to remove ${type}: ${filename} (no entry in manifest)`);
      }
    }
  }

  fs.writeFileSync(manifestPath, JSON.stringify(nextManifest, null, 2));
}
