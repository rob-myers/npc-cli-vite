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
import { worldToSguScale } from "@npc-cli/ui__world/const.env";
import { Mat, Rect } from "@npc-cli/util/geom";
import type { GeoJsonPolygon } from "@npc-cli/util/geom.schema";
import { geomService } from "@npc-cli/util/geom-service";
import { jsonParser } from "@npc-cli/util/json-parser";
import { deepClone, error, info, safeJsonCompact, warn } from "@npc-cli/util/legacy/generic";
import { drawPolygons } from "@npc-cli/util/service/canvas";
import { Canvas, loadImage } from "skia-canvas";
import z from "zod";
import { PROJECT_ROOT } from "../const.ts";

const ASSETS_JSON_PATH = path.resolve(PROJECT_ROOT, "packages/app/public/assets.json");

export async function deleteSavedFile(fileSpecifier: MapEditFileSpecifier) {
  await ensureManifests(fileSpecifier.type, { changedFiles: [], removedFiles: [fileSpecifier] });
  if (fileSpecifier.type === "map") {
    const assets = JSON.parse(fs.readFileSync(ASSETS_JSON_PATH, "utf-8"));
    delete assets.map[fileSpecifier.key];
    fs.writeFileSync(ASSETS_JSON_PATH, safeJsonCompact(assets));
  }
}

function getImageOrSymbolNodeImageUrl(node: ImageMapNode | SymbolMapNode) {
  return node.type === "image" && node.srcType === "decor"
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

/** Writes a MapEdit file, returning it parsed. Then `updateManifests`, and `createSavedFileThumbnail` */
export function writeMapEditFile(filePath: string, body: string) {
  const fileToSave = parseRawMapEditFile(body);
  fs.writeFileSync(filePath, safeJsonCompact(fileToSave));
  return fileToSave;
}

/** Brings both manifests up to date with a saved file: only it is read again */
export async function updateManifests(fileToSave: MapEditSavedFile) {
  await ensureManifests("symbol", { changedFiles: [fileToSave].filter((x) => x.type === "symbol") });
  await ensureManifests("map", { changedFiles: [fileToSave].filter((x) => x.type === "map") });
}

/** Draws a saved file's thumbnail: slow, so the dev server draws it after the World updates */
export async function createSavedFileThumbnail(savedFile: MapEditSavedFile) {
  const isHullSymbol = savedFile.type === "symbol" && isHullSymbolImageKey(savedFile.key);
  const { filename, nodes, bounds } = savedFile;
  const outputThumbnailFilepath = path.resolve(
    PROJECT_ROOT,
    `packages/app/public/${savedFile.type}`,
    `${path.basename(filename, ".json")}.thumbnail.png`,
  );

  const integralBounds = Rect.fromJson(bounds).integerOrds();
  /** A map's thumbnail fits within 1200 px */
  const scale =
    savedFile.type === "map" ? Math.min(2, 1200 / Math.max(integralBounds.width, integralBounds.height)) : 2;
  const canvas = new Canvas(Math.ceil(integralBounds.width * scale), Math.ceil(integralBounds.height * scale));
  const ct = canvas.getContext("2d");

  if (savedFile.type === "map") {
    // each geomorph's walls in white, from its layout (metres), door gaps and all: no other detail
    await traverseNodesAsync(nodes, async (node) => {
      if (node.type !== "symbol" || node.srcKey === null || !isHullSymbolImageKey(node.srcKey)) return;
      const layoutFile = path.resolve(PROJECT_ROOT, "packages/app/public/layout", `${node.srcKey}.json`);
      if (!fs.existsSync(layoutFile)) return;
      const { walls } = JSON.parse(fs.readFileSync(layoutFile, "utf-8")) as { walls: GeoJsonPolygon[] };
      const { a, b, c, d, e, f } = node.transform;
      ct.setTransform(scale, 0, 0, scale, 0, 0);
      ct.translate(-bounds.x, -bounds.y);
      ct.transform(a, b, c, d, e, f);
      ct.scale(worldToSguScale, worldToSguScale);
      const trace = (polys: GeoJsonPolygon[]) => {
        ct.beginPath();
        for (const ring of polys.flatMap((x) => x.coordinates)) {
          ring.forEach(([x, y], i) => (i === 0 ? ct.moveTo(x, y) : ct.lineTo(x, y)));
          ct.closePath();
        }
      };
      ct.fillStyle = ct.strokeStyle = "#fff";
      trace(walls.filter((x) => x.meta.broad !== true));
      ct.fill("evenodd");
      // a solid block, e.g. a fuel tank, is outlined
      trace(walls.filter((x) => x.meta.broad === true));
      ct.lineWidth = 0.1;
      ct.stroke();
    });
    return await canvas.toFile(outputThumbnailFilepath);
  }

  await traverseNodesAsync(nodes, async (node) => {
    if (!isNodeTransformable(node)) return;

    const [a, b, c, d, tx, ty] = new Mat(node.cssTransform).toArray();
    ct.setTransform(scale, 0, 0, scale, 0, 0);
    ct.translate(-bounds.x, -bounds.y);
    ct.transform(a, b, c, d, tx, ty);

    switch (node.type) {
      case "image":
      case "symbol": {
        if (isHullSymbol) break; // avoid large hull thumbnails
        if (node.srcKey === null) break;

        const image = await loadImage(getImageOrSymbolNodeImageUrl(node));
        if (node.type === "image") ct.globalAlpha = node.locked ? 0.2 : 1;

        if (node.type === "image" && node.srcType === "decor") {
          // decor SVGs are at their natural size — draw at baseRect dimensions
          ct.drawImage(image, 0, 0, node.baseRect.width, node.baseRect.height);
        } else {
          // starship-symbol PNGs are 5× their world size, so scale down
          ct.scale(0.2, 0.2);
          ct.drawImage(image, 0, 0, image.width, image.height);
          ct.scale(5, 5);
        }

        ct.globalAlpha = 1;
        break;
      }
      case "rect": {
        const isWall = node.name.startsWith("wall");
        ct.fillStyle = isHullSymbol
          ? isWall
            ? hullInk.wall
            : hullInk.door
          : isWall
            ? "rgba(255,0,0,0.2)"
            : "rgba(0,255,0,0.2)";
        ct.fillRect(0, 0, node.baseRect.width, node.baseRect.height);
        break;
      }
      case "path": {
        ct.strokeStyle = isHullSymbol ? "rgba(0,0,0,0)" : "rgba(0,0,0,1)";
        ct.fillStyle = isHullSymbol ? hullInk.hull : "rgba(255,255,0,0.25)";
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
    return warn(`Skipping thumbnail generation for ${filename} due to zero width or height`);
  }

  if (isHullSymbol) {
    ct.resetTransform();
    ct.font = "100px sans-serif";
    ct.fillStyle = hullInk.hull;
    const rect = ct.measureText(savedFile.key);
    ct.fillText(savedFile.key, (canvas.width - rect.width) / 2, (canvas.height + 32) / 2);
  }

  await canvas.toFile(outputThumbnailFilepath);
}

/** A hull symbol's thumbnail is all MapEdit shows of it in a map, on a dark page or a light one */
const hullInk = {
  hull: "rgba(120, 132, 152, 0.9)",
  wall: "rgba(205, 80, 80, 0.75)",
  door: "rgba(40, 165, 80, 0.85)",
};

type ProcessFileOpts = {
  changedFiles?: MapEditSavedFile[];
  removedFiles?: MapEditFileSpecifier[];
};

/**
 * 🚧 two separate functions
 *
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
  // by key, so a file renamed and back leaves the manifest as it was
  const nextManifest = { byKey: Object.fromEntries(Object.entries(byKey).sort(([a], [b]) => (a < b ? -1 : 1))) };
  const nextManifestRaw = safeJsonCompact(z.decode(schema.manifest, nextManifest));

  if (prevManifestRaw === nextManifestRaw) {
    info(`${path.basename(import.meta.filename)}: ${type}: no changes detected`);
    return;
  }

  info(`${path.basename(import.meta.filename)}: ${type}: changes detected`);
  fs.writeFileSync(manifestPath, nextManifestRaw);
}
