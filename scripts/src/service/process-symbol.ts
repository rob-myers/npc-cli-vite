import fs, { readFileSync } from "node:fs";
import path from "node:path";
import type {
  MapEditSavedFile,
  MapEditSavedMap,
  MapEditSavedSymbol,
  MapsManifest,
  SymbolsManifest,
} from "@npc-cli/ui__map-edit";
import {
  MapEditSavedFileSchema,
  MapsManifestSchema,
  SymbolsManifestSchema,
  traverseNodesAsync,
} from "@npc-cli/ui__map-edit/map-node-api";
import { Mat } from "@npc-cli/util/geom";
import { jsonParser } from "@npc-cli/util/json-parser";
import { error, warn } from "@npc-cli/util/legacy/generic";
import { Canvas, loadImage } from "skia-canvas";
import z from "zod";
import { PROJECT_ROOT } from "../const.ts";

export async function processSavedFile(savedFile: MapEditSavedFile) {
  if (savedFile.type === "symbol") {
    await createSavedSymbolPreviewPng(savedFile);
  }
  if (savedFile.type === "map") {
    await createSavedMapPreviewPng(savedFile);
  }

  await ensureManifests(
    "symbol",
    SymbolsManifestSchema,
    [savedFile].filter((x) => x.type === "symbol"),
  );
  await ensureManifests(
    "map",
    MapsManifestSchema,
    [savedFile].filter((x) => x.type === "map"),
  );
}

async function createSavedSymbolPreviewPng(savedFile: MapEditSavedSymbol) {
  const { width, height, filename, nodes } = savedFile;
  // const scale = 200 / width;
  const scale = 1;
  const canvas = new Canvas(width * scale, height * scale);
  const ct = canvas.getContext("2d");

  await traverseNodesAsync(nodes, async (node) => {
    switch (node.type) {
      case "image": {
        const image = await loadImage(
          path.resolve(PROJECT_ROOT, "packages/app/public/starship-symbol", `${node.imageKey}.png`),
        );
        ct.setTransform(...new Mat(node.cssTransform).postMultiply([scale, 0, 0, scale, scale, scale]).toArray());
        ct.drawImage(image, 0, 0, node.baseRect.width, node.baseRect.height);
        break;
      }
      case "rect": {
        ct.setTransform(...new Mat(node.cssTransform).toArray());
        ct.scale(scale, scale);
        ct.fillStyle = "red";
        ct.fillRect(0, 0, node.baseRect.width, node.baseRect.height);
        break;
      }
    }
  });

  const dstPath = path.resolve(
    PROJECT_ROOT,
    "packages/app/public/symbol",
    `${path.basename(filename, ".json")}.thumbnail.png`,
  );
  await canvas.toFile(dstPath);
}

async function createSavedMapPreviewPng(savedFile: MapEditSavedMap) {
  const { width, height, filename, nodes } = savedFile;
  const canvas = new Canvas(200, 200 * (height / width));
  const _ct = canvas.getContext("2d");
  console.log("🚧 createSavedMapPreviewPng", { filename });
}

/**
 * - if `changedFiles` null then regenerate all
 * - otherwise ensure `changedFiles` and also missing files
 */
async function ensureManifests<T extends SymbolsManifest | MapsManifest>(
  type: "symbol" | "map",
  schema: z.ZodType<T>,
  changedFiles: null | MapEditSavedFile[],
) {
  const manifestPath = path.resolve(PROJECT_ROOT, `packages/app/public/${type}`, "manifest.json");
  const createdAt = new Date().toISOString();
  const nextManifest: T =
    jsonParser.pipe(schema).safeParse(await fs.promises.readFile(manifestPath, "utf-8").catch(warn)).data ??
    ({
      createdAt,
      byFilename: {},
    } as T);

  const filePaths = fs
    .globSync(path.resolve(PROJECT_ROOT, `packages/app/public/${type}/*.json`))
    .filter((x) => path.basename(x) !== "manifest.json");

  const changedFilenames = changedFiles?.map((x) => x.filename) ?? filePaths.map((x) => path.basename(x));

  for (const filePath of filePaths) {
    const filename = path.basename(filePath);
    if (nextManifest.byFilename[filename] && !changedFilenames.includes(filename)) continue;

    const result = jsonParser.pipe(MapEditSavedFileSchema).safeParse(readFileSync(filePath, "utf-8"));
    if (result.success) {
      nextManifest.byFilename[filename] = {
        filename,
        thumbnailFilename: `${path.basename(filename, ".json")}.thumbnail.png`,
        width: result.data.width,
        height: result.data.height,
      };
    } else {
      error(`Failed to parse existing ${type}: ${filename}`, z.prettifyError(result.error));
    }
  }

  fs.writeFileSync(manifestPath, JSON.stringify(nextManifest, null, 2));
}
