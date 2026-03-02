import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
// ⚠️ non-type import breaks vite dev env
import {
  type ALLOWED_MAP_EDIT_FOLDERS,
  type MapEditFileSpecifier,
  type MapEditListFilesResponse,
  type MapEditListFoldersResponse,
  type MapEditSavableFileType,
  MapEditSavedFileSchema,
} from "@npc-cli/ui__map-edit/map-node-api";
import { jsonParser } from "@npc-cli/util/json-parser";
import type { Connect, Plugin } from "vite";
import { PROJECT_ROOT } from "./const.ts";

const PUBLIC_DIR = path.join(PROJECT_ROOT, "packages/app/public");

export function mapEditApiPlugin(): Plugin {
  return {
    name: "map-edit-api",
    configureServer(server) {
      // Ensure folders exist
      for (const folder of MIRRORED_ALLOWED_MAP_EDIT_FOLDERS) {
        const dir = path.join(PUBLIC_DIR, folder);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      }

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/map-edit/")) {
          return next();
        }

        res.setHeader("Content-Type", "application/json");

        try {
          // GET /api/map-edit/files
          // List all files from allowed folders
          if (req.url === "/api/map-edit/files" && req.method === "GET") {
            return onGetApiMapEditFiles(res);
          }

          // GET /api/map-edit/folders
          // List allowed folders
          if (req.url === "/api/map-edit/folders" && req.method === "GET") {
            return onGetApiMapEditFolders(res);
          }

          // GET POST DELETE /api/map-edit/file/:folder/:filename
          // File operations
          if (await handleApiMapEditFile(req, res)) {
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

function onGetApiMapEditFiles(res: ServerResponse<IncomingMessage>) {
  const files = MIRRORED_ALLOWED_MAP_EDIT_FOLDERS.flatMap(getFilesFromFolder).sort();
  const response: MapEditListFilesResponse = { files };
  res.end(JSON.stringify(response));
}

function onGetApiMapEditFolders(res: ServerResponse<IncomingMessage>) {
  const response: MapEditListFoldersResponse = { folders: MIRRORED_ALLOWED_MAP_EDIT_FOLDERS };
  res.end(JSON.stringify(response));
}

async function handleApiMapEditFile(
  req: Connect.IncomingMessage,
  res: ServerResponse<IncomingMessage>,
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
  if (!MIRRORED_ALLOWED_MAP_EDIT_FOLDERS.includes(folder as MapEditSavableFileType)) {
    res.statusCode = 400;
    res.end(
      JSON.stringify({
        error: `Invalid folder. Allowed: ${MIRRORED_ALLOWED_MAP_EDIT_FOLDERS.join(", ")}`,
      }),
    );
    return;
  }

  const filePath = path.join(PUBLIC_DIR, folder, `${filename}.json`);

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
    const savedFile = jsonParser
      .pipe(MapEditSavedFileSchema)
      .parse(fs.readFileSync(filePath, "utf-8"));
    res.end(JSON.stringify(savedFile));
    return true;
  }

  // POST - Save file
  if (req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;

    const fileToSave = jsonParser.pipe(MapEditSavedFileSchema).parse(body);
    fs.writeFileSync(filePath, JSON.stringify(fileToSave, null, 2));

    // create PNG preview
    if (fileToSave.type === "symbol") {
      // hot reloading via cache busting
      await import(`./service/render-symbol.ts?t=${Date.now()}`).then(
        ({ createSavedSymbolPreviewPng }) => {
          createSavedSymbolPreviewPng(fileToSave);
        },
      );
    }
    if (fileToSave.type === "map") {
      // 🚧 unify
      await import(`./service/render-symbol.ts?t=${Date.now()}`).then(
        ({ createSavedMapPreviewPng }) => {
          createSavedMapPreviewPng(fileToSave);
        },
      );
    }

    res.end(JSON.stringify({ success: true }));
    return true;
  }

  // DELETE - Delete file
  if (req.method === "DELETE") {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    res.end(JSON.stringify({ success: true }));
    return true;
  }
}

function getFilesFromFolder(folder: MapEditSavableFileType): MapEditFileSpecifier[] {
  return fs
    .globSync(path.join(PUBLIC_DIR, folder, "*.json"))
    .map((filePath) => ({ type: folder, filename: path.basename(filePath, ".json") }));
}

export const MIRRORED_ALLOWED_MAP_EDIT_FOLDERS: typeof ALLOWED_MAP_EDIT_FOLDERS = ["symbol", "map"];
