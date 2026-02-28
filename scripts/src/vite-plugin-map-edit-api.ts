import fs from "node:fs";
import path from "node:path";
// ⚠️ non-type import breaks vite dev env
import type {
  ALLOWED_MAP_EDIT_FOLDERS,
  MapEditFileSpecifier,
  MapEditListFilesResponse,
  MapEditSavableFileType,
  MapEditSavedFile,
} from "@npc-cli/ui__map-edit";
import type { Plugin } from "vite";
import { PROJECT_ROOT } from "./const.ts";

const PUBLIC_DIR = path.join(PROJECT_ROOT, "packages/app/public");

export function mapEditApiPlugin(): Plugin {
  return {
    name: "map-edit-api",
    configureServer(server) {
      // Ensure folders exist
      for (const folder of MIRRORED_ALLOWED_MAP_EDIT_FOLDERS) {
        const dir = path.join(PUBLIC_DIR, folder);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/map-edit/")) {
          return next();
        }

        // Set JSON content type for all responses
        res.setHeader("Content-Type", "application/json");

        try {
          // GET /api/map-edit/files - List all files from allowed folders
          if (req.url === "/api/map-edit/files" && req.method === "GET") {
            const files = MIRRORED_ALLOWED_MAP_EDIT_FOLDERS.flatMap(getFilesFromFolder).sort();
            const response: MapEditListFilesResponse = { files };
            res.end(JSON.stringify({ files }));
            return;
          }

          // GET /api/map-edit/folders - List allowed folders
          if (req.url === "/api/map-edit/folders" && req.method === "GET") {
            res.end(JSON.stringify({ folders: MIRRORED_ALLOWED_MAP_EDIT_FOLDERS }));
            return;
          }

          // File operations: /api/map-edit/file/:folder/:filename
          const fileMatch = req.url.match(/^\/api\/map-edit\/file\/(.+)$/);
          if (fileMatch) {
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
              return;
            }

            // GET - Read file
            if (req.method === "GET") {
              if (!fs.existsSync(filePath)) {
                res.statusCode = 404;
                res.end(JSON.stringify({ error: "File not found" }));
                return;
              }

              // 🚧 zod parser for MapEditSavedFile
              const response = JSON.parse(fs.readFileSync(filePath, "utf-8")) as MapEditSavedFile;
              res.end(JSON.stringify(response));
              return;
            }

            // POST - Save file
            if (req.method === "POST") {
              let body = "";
              for await (const chunk of req) body += chunk;
              // 🚧 zod parser for MapEditSavedFile
              const savedFile = JSON.parse(body) as MapEditSavedFile;
              fs.writeFileSync(filePath, JSON.stringify(savedFile, null, 2));
              res.end(JSON.stringify({ success: true }));
              return;
            }

            // DELETE - Delete file
            if (req.method === "DELETE") {
              if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
              }
              res.end(JSON.stringify({ success: true }));
              return;
            }
          }

          res.statusCode = 404;
          res.end(JSON.stringify({ error: "Not found" }));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(error) }));
        }
      });
    },
  };
}

function getFilesFromFolder(folder: MapEditSavableFileType): MapEditFileSpecifier[] {
  return fs
    .globSync(path.join(PUBLIC_DIR, folder, "*.json"))
    .map((filePath) => ({ type: folder, filename: path.basename(filePath, ".json") }));
}

export const MIRRORED_ALLOWED_MAP_EDIT_FOLDERS: typeof ALLOWED_MAP_EDIT_FOLDERS = ["symbol", "map"];
