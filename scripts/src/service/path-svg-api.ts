import fs from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../const.ts";

const PATH_DIR = path.join(PROJECT_ROOT, "packages/app/public/path");

export function savePathSvg(filename: string, body: { title: string; width: number; height: number; d: string }) {
  if (!filename.endsWith(".svg")) filename += ".svg";
  const filePath = path.join(PATH_DIR, filename);

  if (!filePath.startsWith(PATH_DIR)) {
    throw new Error("Invalid filename");
  }

  if (!fs.existsSync(PATH_DIR)) {
    fs.mkdirSync(PATH_DIR, { recursive: true });
  }

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${body.width} ${body.height}">`,
    `  <path d="${body.d}" fill="#eab308" stroke="#ca8a04"><title>${body.title}</title></path>`,
    `</svg>`,
  ].join("\n");

  fs.writeFileSync(filePath, svg);
  return { success: true, path: filePath };
}
