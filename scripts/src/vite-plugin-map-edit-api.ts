// ⚠️ this plugin does not hot-reload, so we use imports and cache bust them

import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { type ALLOWED_MAP_EDIT_FOLDERS, isSavableFileType } from "@npc-cli/ui__map-edit/map-node-api";
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
          // GET, POST, DELETE
          // /api/map-edit/file/:folder/:filename
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

async function handleApiMapEditFile(req: Connect.IncomingMessage, res: ServerResponse<IncomingMessage>) {
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

    // ⚠️ must "hot reload" via cache busting (this plugin doesn't hot-reload)
    const { parseRawMapEditFile } = (await import(
      `./service/process-symbol.ts?t=${Date.now()}`
    )) as typeof import("./service/process-symbol");

    const savedFile = parseRawMapEditFile(fs.readFileSync(filePath, "utf-8")); // throws on error
    res.end(JSON.stringify(savedFile));
    return true;
  }

  // POST - Save file
  if (req.method === "POST") {
    let body = "";
    for await (const chunk of req) body += chunk;

    // ⚠️ must "hot reload" via cache busting (this plugin doesn't hot-reload)
    const { parseRawMapEditFile, processSavedFile } = (await import(
      `./service/process-symbol.ts?t=${Date.now()}`
    )) as typeof import("./service/process-symbol");

    const fileToSave = parseRawMapEditFile(body); // throws on error
    fs.writeFileSync(filePath, JSON.stringify(fileToSave, null, 2));
    processSavedFile(fileToSave);

    res.end(JSON.stringify({ success: true }));
    return true;
  }

  // DELETE - Delete file and related cache
  if (req.method === "DELETE") {
    // ⚠️ must "hot reload" via cache busting (this plugin doesn't hot-reload)
    const { deleteSavedFile, parseMapEditFileSpecifier } = (await import(
      `./service/process-symbol.ts?t=${Date.now()}`
    )) as typeof import("./service/process-symbol");

    deleteSavedFile(parseMapEditFileSpecifier({ type: folder, filename }));

    res.end(JSON.stringify({ success: true }));
    return true;
  }
}

export const MIRRORED_ALLOWED_MAP_EDIT_FOLDERS: typeof ALLOWED_MAP_EDIT_FOLDERS = ["symbol", "map"];
