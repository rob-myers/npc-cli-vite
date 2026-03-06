import fs, { readFileSync } from "node:fs";
import path from "node:path";
import type { MapEditFileSpecifier, MapEditSavedFile, MapsManifest, SymbolsManifest } from "@npc-cli/ui__map-edit";
import { Mat } from "@npc-cli/util/geom";
import { jsonParser } from "@npc-cli/util/json-parser";
import { error, warn } from "@npc-cli/util/legacy/generic";
import { Canvas, loadImage } from "skia-canvas";
import z from "zod";
import { PROJECT_ROOT } from "../const.ts";

// ⚠️ fix stale schemas via cache busting
const { MapEditSavedFileSchema, MapsManifestSchema, SymbolsManifestSchema, traverseNodesAsync } = (await import(
  `../../../packages/ui/map-edit/src/map-node-api.ts?t=${Date.now()}`
)) as typeof import("@npc-cli/ui__map-edit/map-node-api");

export async function deleteSavedFile({ type, filename }: MapEditFileSpecifier) {
  await ensureManifests(type, SymbolsManifestSchema, { changedFiles: [], removedFiles: [{ type, filename }] });
}

export function parseRawMapEdit(rawFileString: string) {
  return jsonParser.pipe(MapEditSavedFileSchema).parse(rawFileString);
}

export async function processSavedFile(savedFile: MapEditSavedFile) {
  // currently same for symbol or map
  await createSavedFilePreviewPng(savedFile);

  // ensure both manifests
  await ensureManifests("symbol", SymbolsManifestSchema, {
    changedFiles: [savedFile].filter((x) => x.type === "symbol"),
  });
  await ensureManifests("map", MapsManifestSchema, { changedFiles: [savedFile].filter((x) => x.type === "map") });
}

async function createSavedFilePreviewPng(savedFile: MapEditSavedFile) {
  const { filename, nodes, bounds } = savedFile;
  const scale = 1;
  const canvas = new Canvas(bounds.width * scale, bounds.height * scale);
  const ct = canvas.getContext("2d");

  await traverseNodesAsync(nodes, async (node) => {
    switch (node.type) {
      case "image": {
        const image = await loadImage(
          path.resolve(PROJECT_ROOT, "packages/app/public/starship-symbol", `${node.imageKey}.png`),
        );
        ct.setTransform(...new Mat(node.cssTransform).toArray());
        ct.scale(scale, scale);
        ct.translate(-bounds.x, -bounds.y);
        ct.drawImage(image, 0, 0, node.baseRect.width, node.baseRect.height);
        break;
      }
      case "rect": {
        ct.setTransform(...new Mat(node.cssTransform).toArray());
        ct.scale(scale, scale);
        ct.translate(-bounds.x, -bounds.y);
        ct.fillStyle = "red";
        ct.fillRect(0, 0, node.baseRect.width, node.baseRect.height);
        break;
      }
    }
  });

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
async function ensureManifests<T extends SymbolsManifest | MapsManifest>(
  type: "symbol" | "map",
  schema: z.ZodType<T>,
  opts: ProcessFileOpts,
) {
  const manifestPath = path.resolve(PROJECT_ROOT, `packages/app/public/${type}`, "manifest.json");
  const createdAt = new Date().toISOString();
  const nextManifest: T =
    jsonParser.pipe(schema).safeParse(await fs.promises.readFile(manifestPath, "utf-8").catch(warn)).data ??
    ({
      createdAt,
      byFilename: {},
    } as T);

  const directory = path.resolve(PROJECT_ROOT, `packages/app/public/${type}`);
  const filePaths = fs.globSync(path.resolve(directory, "*.json")).filter((x) => path.basename(x) !== "manifest.json");

  const changedFilenames = opts.changedFiles?.map((x) => x.filename) ?? filePaths.map((x) => path.basename(x));

  for (const filePath of filePaths) {
    const filename = path.basename(filePath);

    if (!nextManifest.byFilename[filename] || changedFilenames.includes(filename)) {
      const result = jsonParser.pipe(MapEditSavedFileSchema).safeParse(readFileSync(filePath, "utf-8"));
      if (result.success) {
        nextManifest.byFilename[filename] = {
          filename,
          thumbnailFilename: `${path.basename(filename, ".json")}.thumbnail.png`,
          width: result.data.width,
          height: result.data.height,
          bounds: result.data.bounds,
        };
      } else {
        error(`Failed to parse existing ${type}: ${filename}`, z.prettifyError(result.error));
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
