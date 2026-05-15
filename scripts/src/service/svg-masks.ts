import fs, { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { geomService, Poly, Vect } from "@npc-cli/util/geom";
import { Parser } from "htmlparser2";

type MaskFilePolys = { remove: Geom.Poly[]; white: Geom.Poly[] };

/**
 * Collect all "mask remove" and "mask white" polygons from SVGs in `maskDir`.
 *
 * Each SVG is named `{symbolKey}.svg` and may contain `<path>` or `<rect>`
 * elements with a `<title>mask remove</title>` or `<title>mask white</title>` child.
 *
 * Returns polygons in SVG viewBox coordinates.
 */
export function collectMasks(maskDir: string): Partial<Record<string, MaskFilePolys>> {
  if (!existsSync(maskDir)) return {};
  const result: Partial<Record<string, MaskFilePolys>> = {};

  for (const file of fs.readdirSync(maskDir).filter((f: string) => f.endsWith(".svg"))) {
    const symbolKey = file.slice(0, -4); // strip .svg
    const svgContent = readFileSync(path.resolve(maskDir, file), "utf-8");
    const polys = parseMaskPolygons(svgContent);
    result[symbolKey] = polys;
  }

  return result;
}

function parseMaskPolygons(svgContent: string): MaskFilePolys {
  const result: MaskFilePolys = { remove: [], white: [] };
  const stack: { name: string; attrs: Record<string, string> }[] = [];

  const parser = new Parser({
    onopentag(name, attrs) {
      stack.push({ name, attrs });
    },
    ontext(text) {
      if (!(text === "mask remove" || text === "mask white") || stack.length < 2) return;
      const current = stack[stack.length - 1];
      if (current.name !== "title") return;
      const parent = stack[stack.length - 2];
      const items = result[text === "mask remove" ? "remove" : "white"];

      if (parent.name === "path" && parent.attrs.d) {
        const poly = geomService.svgPathToPolygon(parent.attrs.d);
        if (poly) result[text === "mask remove" ? "remove" : "white"].push(poly);
      } else if (parent.name === "rect") {
        const x = Number.parseFloat(parent.attrs.x || "0");
        const y = Number.parseFloat(parent.attrs.y || "0");
        const w = Number.parseFloat(parent.attrs.width || "0");
        const h = Number.parseFloat(parent.attrs.height || "0");
        if (w > 0 && h > 0) {
          items.push(new Poly([new Vect(x, y), new Vect(x + w, y), new Vect(x + w, y + h), new Vect(x, y + h)]));
        }
      }
    },
    onclosetag() {
      stack.pop();
    },
  });

  parser.write(svgContent);
  parser.end();
  return result;
}
