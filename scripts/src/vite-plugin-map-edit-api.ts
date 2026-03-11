import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import {
  type ALLOWED_MAP_EDIT_FOLDERS,
  devMessageFromServer,
  isSavableFileType,
  type PathManifest,
  PathManifestEntrySchema,
  PathManifestSchema,
} from "@npc-cli/ui__map-edit/map-node-api";
import { jsonParser } from "@npc-cli/util/json-parser";
import { info, warn } from "@npc-cli/util/legacy/generic";
import { Parser } from "htmlparser2";
import type { Connect, Plugin, ViteDevServer } from "vite";
import { PROJECT_ROOT } from "./const.ts";

const PUBLIC_DIR = path.join(PROJECT_ROOT, "packages/app/public");
const PROCESS_SYMBOL_PATH = path.join(PROJECT_ROOT, "scripts/src/service/process-symbol.ts");
const PATH_DIR = path.join(PUBLIC_DIR, "path");

export function mapEditApiPlugin(): Plugin {
  let server: ViteDevServer;
  return {
    name: "map-edit-api",
    configureServer(_server) {
      server = _server;
      // Ensure folders exist
      for (const folder of MIRRORED_ALLOWED_MAP_EDIT_FOLDERS) {
        const dir = path.join(PUBLIC_DIR, folder);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      }

      watchPathSvgs(server);

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/map-edit/")) {
          return next();
        }

        res.setHeader("Content-Type", "application/json");

        try {
          // GET, POST, DELETE
          // /api/map-edit/file/:folder/:filename
          if (await handleApiMapEditFile(req, res, server)) {
            return;
          }

          res.statusCode = 404;
          res.end(JSON.stringify({ error: "Not found" }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error }));
          console.error(error);
        }
      });
    },
  };
}

async function handleApiMapEditFile(
  req: Connect.IncomingMessage,
  res: ServerResponse<IncomingMessage>,
  server: ViteDevServer,
) {
  const fileMatch = req.url?.match(/^\/api\/map-edit\/file\/(.+)$/);
  if (!fileMatch) return;

  const fullPath = decodeURIComponent(fileMatch[1]);
  const parts = fullPath.split("/");
  if (parts.length !== 2) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Path must be folder/filename" }));
    return;
  }
  const [folder, filename] = parts;
  if (!isSavableFileType(folder)) {
    res.statusCode = 400;
    res.end(
      JSON.stringify({
        error: `Invalid folder. Allowed: ${MIRRORED_ALLOWED_MAP_EDIT_FOLDERS.join(", ")}`,
      }),
    );
    return;
  }

  // extension should .json
  const filePath = path.join(PUBLIC_DIR, folder, filename);

  // Prevent directory traversal
  if (!filePath.startsWith(path.join(PUBLIC_DIR, folder))) {
    res.statusCode = 400;
    res.end(JSON.stringify({ error: "Invalid filename" }));
    return true;
  }

  // GET - Read file
  if (req.method === "GET") {
    if (!fs.existsSync(filePath)) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "File not found" }));
      return true;
    }

    const { parseRawMapEditFile } = (await server.ssrLoadModule(
      PROCESS_SYMBOL_PATH,
    )) as typeof import("./service/process-symbol");

    const savedFile = parseRawMapEditFile(fs.readFileSync(filePath, "utf-8")); // throws on error
    res.end(JSON.stringify(savedFile));
    return true;
  }

  // POST - Save file
  if (req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;

    const { parseRawMapEditFile, processSavedFile } = (await server.ssrLoadModule(
      PROCESS_SYMBOL_PATH,
    )) as typeof import("./service/process-symbol");

    const fileToSave = parseRawMapEditFile(body); // throws on error
    fs.writeFileSync(filePath, JSON.stringify(fileToSave, null, 2));
    processSavedFile(fileToSave);

    res.end(JSON.stringify({ success: true }));
    return true;
  }

  // DELETE - Delete file and related cache
  if (req.method === "DELETE") {
    const { deleteSavedFile, parseMapEditFileSpecifier } = (await server.ssrLoadModule(
      PROCESS_SYMBOL_PATH,
    )) as typeof import("./service/process-symbol");

    deleteSavedFile(parseMapEditFileSpecifier({ type: folder, filename, key: path.basename(filename, ".json") }));

    res.end(JSON.stringify({ success: true }));
    return true;
  }
}

export const MIRRORED_ALLOWED_MAP_EDIT_FOLDERS: typeof ALLOWED_MAP_EDIT_FOLDERS = ["symbol", "map"];

function watchPathSvgs(server: ViteDevServer) {
  const manifestPath = path.join(PATH_DIR, "manifest.json");
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const rebuild = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      rebuildPathManifest(manifestPath, server);
    }, 200);
  };

  server.watcher.add(path.join(PATH_DIR, "*.svg"));
  server.watcher.on("add", (filePath) => isPathSvg(filePath) && rebuild());
  server.watcher.on("change", (filePath) => isPathSvg(filePath) && rebuild());
  server.watcher.on("unlink", (filePath) => isPathSvg(filePath) && rebuild());

  // initial build (no notification needed)
  rebuildPathManifest(manifestPath, null);
}

function isPathSvg(filePath: string) {
  return filePath.startsWith(PATH_DIR) && filePath.endsWith(".svg");
}

async function rebuildPathManifest(manifestPath: string, server: ViteDevServer | null) {
  const svgFiles = fs.globSync(path.join(PATH_DIR, "*.svg"));
  const byKey: PathManifest["byKey"] = {};

  for (const filePath of svgFiles) {
    const filename = path.basename(filePath);
    const key = path.basename(filename, ".svg");
    const content = fs.readFileSync(filePath, "utf-8");
    const entry = parseSvgForManifest(content, filename, key);
    // must re-parse to ensure key-ordering
    if (entry) byKey[key] = PathManifestEntrySchema.parse(entry);
  }

  const prevManifest = jsonParser
    .pipe(PathManifestSchema)
    .safeParse(await fs.promises.readFile(manifestPath, "utf-8").catch(warn)).data;

  if (JSON.stringify(prevManifest?.byKey) === JSON.stringify(byKey)) {
    info(`[map-edit-api] path/manifest.json: no changes detected`);
    return;
  }

  const nextManifest: PathManifest = { modifiedAt: new Date().toISOString(), byKey };
  fs.writeFileSync(manifestPath, JSON.stringify(nextManifest, null, 2));
  info(`[map-edit-api] rebuilt path/manifest.json`);
  server?.hot.send({ type: "custom", event: devMessageFromServer.recomputedPathManifest });
}

function parseSvgForManifest(
  svgContent: string,
  filename: string,
  key: string,
): { filename: string; key: string; pathCount: number; width: number; height: number } | null {
  let width = 0;
  let height = 0;
  let pathCount = 0;
  let depth = 0;

  const parser = new Parser({
    onopentag(name, attrs) {
      if (name === "svg" && depth === 0) {
        width = parseInt(attrs.width, 10) || 0;
        height = parseInt(attrs.height, 10) || 0;
      }
      if (name === "path" && depth === 1) {
        pathCount++;
      }
      depth++;
    },
    onclosetag() {
      depth--;
    },
  });

  parser.write(svgContent);
  parser.end();

  if (width === 0 || height === 0) {
    warn(`[map-edit-api] SVG ${filename} is missing valid width or height attributes. Skipping.`);
    return null;
  }
  return { filename, key, pathCount, width, height };
}
