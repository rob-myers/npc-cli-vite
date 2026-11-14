import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { PROJECT_ROOT } from "./const.ts";

const PUBLIC_DIR = path.join(PROJECT_ROOT, "packages/app/public");

/** The code that draws the skin sheets in a DEV World */
const drawingCode = ["packages/ui/world/src/service/skin-sheets.ts", "packages/ui/world/src/const.both.ts"];

/** The `tEXt` keyword holding a sheet's hash */
const keyword = "npc-cli-hash";

/**
 * What a `skin` or `skin-slices` sheet is drawn from, hashed: its layout, its skins' sources and meta, and the code.
 * A sheet is saved only when this changes, so another browser's rendering never rewrites it
 */
export function skinSheetHash(name: "skin" | "skin-slices", sheetId: number) {
  const read = (file: string) => fs.readFileSync(path.join(PUBLIC_DIR, file));
  const sheets = JSON.parse(read("sheets.json").toString());
  const manifest = JSON.parse(read("skin/manifest.json").toString());
  const [layout, dims] =
    name === "skin" ? [sheets.skin, sheets.skinSheetDims] : [sheets.skinSlices, sheets.skinSlicesSheetDims];
  const keys = Object.keys(layout)
    .filter((key) => layout[key].sheetId === sheetId)
    .sort();
  const hash = crypto.createHash("sha256").update(JSON.stringify([name, dims[sheetId]]));
  for (const key of keys) {
    const skin = manifest.byKey[key];
    hash.update(JSON.stringify([layout[key], sheets.skin[key], skin]));
    if (skin !== undefined) hash.update(read(skin.svgPath ?? `skin/${skin.filename}`));
  }
  for (const file of drawingCode) hash.update(fs.readFileSync(path.join(PROJECT_ROOT, file)));
  return hash.digest("hex").slice(0, 16);
}

/** The png with `hash` in a `tEXt` chunk just before its `IEND` */
export function withHash(png: Buffer, hash: string) {
  const data = Buffer.from(`${keyword}\0${hash}`, "latin1");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write("tEXt", 4, "latin1");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(zlib.crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  const iend = png.length - 12;
  return Buffer.concat([png.subarray(0, iend), chunk, png.subarray(iend)]);
}

/** The hash `withHash` put in the png, else `null` */
export function hashOf(png: Buffer) {
  for (let at = 8; at + 8 <= png.length; ) {
    const length = png.readUInt32BE(at);
    if (png.toString("latin1", at + 4, at + 8) === "tEXt") {
      const text = png.toString("latin1", at + 8, at + 8 + length);
      if (text.startsWith(`${keyword}\0`)) return text.slice(keyword.length + 1);
    }
    at += 12 + length;
  }
  return null;
}
