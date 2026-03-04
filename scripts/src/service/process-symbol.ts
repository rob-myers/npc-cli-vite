import fs, { readFileSync } from "node:fs";
import path from "node:path";
import type { MapEditSavedFile, MapEditSavedMap, MapEditSavedSymbol, SymbolsManifest } from "@npc-cli/ui__map-edit";
import { MapEditSavedFileSchema, SymbolsManifestSchema, traverseNodesAsync } from "@npc-cli/ui__map-edit/map-node-api";
import { Mat } from "@npc-cli/util/geom";
import { jsonParser } from "@npc-cli/util/json-parser";
import { error } from "@npc-cli/util/legacy/generic";
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

  ensureSymbolsManifest({ changedFiles: [savedFile] });
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

function ensureSymbolsManifest({ changedFiles }: { changedFiles: null | MapEditSavedFile[] }) {
  const manifestFilePath = path.resolve(PROJECT_ROOT, "packages/app/public/symbol", "manifest.json");

  const nextManifest: SymbolsManifest = {
    createdAt: new Date().toISOString(),
    byFilename: {},
  };

  if (fs.existsSync(manifestFilePath)) {
    // might be running script sans dev-server, so avoid fetchParsed
    const result = jsonParser.pipe(SymbolsManifestSchema).safeParse(fs.readFileSync(manifestFilePath, "utf-8"));
    if (result.success) {
      nextManifest.byFilename = result.data.byFilename;
    } else {
      error("Failed to parse existing symbols/manifest.json", z.prettifyError(result.error));
    }
  }

  const symbolFilePaths = fs
    .globSync(path.resolve(PROJECT_ROOT, "packages/app/public/symbol/*.json"))
    .filter((x) => x !== manifestFilePath);

  // if changedFiles null then regenerate all
  const changedFilenames = changedFiles?.map((x) => x.filename) ?? symbolFilePaths.map((x) => path.basename(x));

  for (const symbolFilePath of symbolFilePaths) {
    const filename = path.basename(symbolFilePath);
    if (!nextManifest.byFilename[filename] || changedFilenames.includes(filename)) {
      const result = jsonParser.pipe(MapEditSavedFileSchema).safeParse(readFileSync(symbolFilePath, "utf-8"));
      if (result.success) {
        nextManifest.byFilename[filename] = {
          filename,
          thumbnailFilename: `${path.basename(filename, ".json")}.thumbnail.png`,
          width: result.data.width,
          height: result.data.height,
        };
      } else {
        error(`Failed to parse existing symbol: ${filename}`, z.prettifyError(result.error));
      }
    }
  }

  // console.log({ changedFiles, symbolFiles: symbolFilePaths });
  fs.writeFileSync(manifestFilePath, JSON.stringify(nextManifest, null, 2));
}
