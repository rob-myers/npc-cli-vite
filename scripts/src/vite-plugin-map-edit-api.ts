import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { type ALLOWED_MAP_EDIT_FOLDERS, isSavableFileType, MapEditFileSpecifierSchema } from "@npc-cli/ui__map-edit/map-node-api";
import type { Connect, Plugin, ViteDevServer } from "vite";
import { PROJECT_ROOT } from "./const.ts";

const PUBLIC_DIR = path.join(PROJECT_ROOT, "packages/app/public");
const PROCESS_SYMBOL_PATH = path.join(PROJECT_ROOT, "scripts/src/service/process-symbol.ts");
const WATCH_PATH_SVGS_PATH = path.join(PROJECT_ROOT, "scripts/src/service/watch-path-svgs.ts");

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

      server.ssrLoadModule(WATCH_PATH_SVGS_PATH).then((mod) => {
        (mod as typeof import("./service/watch-path-svgs")).watchPathSvgs(server);
      });

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
    const { deleteSavedFile } = (await server.ssrLoadModule(
      PROCESS_SYMBOL_PATH,
    )) as typeof import("./service/process-symbol");

    deleteSavedFile(
      MapEditFileSpecifierSchema.parse({ type: folder, filename, key: path.basename(filename, ".json") }),
    );

    res.end(JSON.stringify({ success: true }));
    return true;
  }
}

export const MIRRORED_ALLOWED_MAP_EDIT_FOLDERS: typeof ALLOWED_MAP_EDIT_FOLDERS = ["symbol", "map"];
