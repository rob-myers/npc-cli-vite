import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { PROJECT_ROOT } from "./const.ts";

const SVG_DIR = path.join(PROJECT_ROOT, "packages/app/public/svg");

export function mapEditApiPlugin(): Plugin {
  return {
    name: "map-edit-api",
    configureServer(server) {
      // Ensure the svg directory exists
      if (!fs.existsSync(SVG_DIR)) {
        fs.mkdirSync(SVG_DIR, { recursive: true });
      }

      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/map-edit/")) {
          return next();
        }

        // Set JSON content type for all responses
        res.setHeader("Content-Type", "application/json");

        try {
          // GET /api/map-edit/files - List all files
          if (req.url === "/api/map-edit/files" && req.method === "GET") {
            const files = fs.existsSync(SVG_DIR)
              ? fs
                  .readdirSync(SVG_DIR)
                  .filter((f) => f.endsWith(".json"))
                  .map((f) => f.replace(/\.json$/, ""))
                  .sort()
              : [];
            res.end(JSON.stringify({ files }));
            return;
          }

          // File operations: /api/map-edit/file/:filename
          const fileMatch = req.url.match(/^\/api\/map-edit\/file\/(.+)$/);
          if (fileMatch) {
            const filename = decodeURIComponent(fileMatch[1]);
            const filePath = path.join(SVG_DIR, `${filename}.json`);

            // Prevent directory traversal
            if (!filePath.startsWith(SVG_DIR)) {
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
              for await (const chunk of req) {
                body += chunk;
              }
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
