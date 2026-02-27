import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { PROJECT_ROOT } from "./const.ts";
import type { OnSaveRequest } from "./types.ts";

const PUBLIC_DIR = path.join(PROJECT_ROOT, "packages/app/public");
const ALLOWED_FOLDERS = ["symbol", "map"] as const;
type AllowedFolder = (typeof ALLOWED_FOLDERS)[number];

export function mapEditApiPlugin(): Plugin {
  return {
    name: "map-edit-api",
    configureServer(server) {
      // Ensure folders exist
      for (const folder of ALLOWED_FOLDERS) {
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
            const files = ALLOWED_FOLDERS.flatMap(getFilesFromFolder).sort();
            res.end(JSON.stringify({ files }));
            return;
          }

          // GET /api/map-edit/folders - List allowed folders
          if (req.url === "/api/map-edit/folders" && req.method === "GET") {
            res.end(JSON.stringify({ folders: ALLOWED_FOLDERS }));
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
            if (!ALLOWED_FOLDERS.includes(folder as AllowedFolder)) {
              res.statusCode = 400;
              res.end(
                JSON.stringify({ error: `Invalid folder. Allowed: ${ALLOWED_FOLDERS.join(", ")}` }),
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
              const content = fs.readFileSync(filePath, "utf-8");
              res.end(JSON.stringify({ content: JSON.parse(content) }));
              return;
            }

            // POST - Save file
            if (req.method === "POST") {
              let body = "";
              for await (const chunk of req) body += chunk;
              const { content } = JSON.parse(body);
              fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
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

          if (req.url === "/api/map-edit/on-save" && req.method === "POST") {
            let body = "";
            for await (const chunk of req) body += chunk;
            const received = JSON.parse(body) as OnSaveRequest;
            // 🚧
            console.info({ onSavePayload: received });
            return;
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

function getFilesFromFolder(folder: AllowedFolder): string[] {
  return fs
    .globSync(path.join(PUBLIC_DIR, folder, "*.json"))
    .map((filePath) => `${folder}/${path.basename(filePath, ".json")}`);
}
