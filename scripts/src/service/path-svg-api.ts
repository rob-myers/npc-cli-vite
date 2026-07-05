import fs from "node:fs";
import path from "node:path";
import { Rect } from "@npc-cli/util/geom";
import { geomService } from "@npc-cli/util/geom-service";
import { PROJECT_ROOT } from "../const.ts";

const PATH_DIR = path.join(PROJECT_ROOT, "packages/app/public/path");

export function savePathSvg(
  filename: string,
  body: { width: number; height: number; paths: { d: string; title: string }[] },
) {
  if (!filename.endsWith(".svg")) filename += ".svg";
  const filePath = path.join(PATH_DIR, filename);

  if (!filePath.startsWith(PATH_DIR)) {
    throw new Error("Invalid filename");
  }

  if (!fs.existsSync(PATH_DIR)) {
    fs.mkdirSync(PATH_DIR, { recursive: true });
  }

  const pathLines = body.paths
    .map((p) => `  <path d="${p.d}" fill="#eab308" stroke="#ca8a04"><title>${p.title}</title></path>`)
    .join("\n");

  const bounds = Rect.fromRects(...body.paths.flatMap((path) => geomService.svgPathToPolygon(path.d)?.rect ?? []));

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.x} ${bounds.y} ${body.width} ${body.height}">`,
    pathLines,
    `</svg>`,
  ].join("\n");

  fs.writeFileSync(filePath, svg);
  return { success: true, path: filePath };
}
