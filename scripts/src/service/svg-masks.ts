import fs, { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { Poly, Vect } from "@npc-cli/util/geom";
import { geomService } from "@npc-cli/util/geom-service";
import { tagsToMeta, textToTags } from "@npc-cli/util/legacy/generic";
import { Parser } from "htmlparser2";

type MaskFilePolys = { remove: Geom.Poly[]; color: { [color: string]: Geom.Poly[] } };

/**
 * Collect all polygons with these titles from SVGs in `maskDir`:
 * - "mask remove"
 * - "mask color={color}"
 *
 * Each SVG is named `{symbolKey}.svg` and may contain `<path>` or `<rect>`
 * elements with a `<title>mask remove</title>` or `<title>mask color={color}</title>` child.
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
  const result: MaskFilePolys = { remove: [], color: {} };
  const stack: { name: string; attrs: Record<string, string> }[] = [];

  const parser = new Parser({
    onopentag(name, attrs) {
      stack.push({ name, attrs });
    },
    ontext(text) {
      if (stack.length < 2) return;

      const tags = tagsToMeta(textToTags(text));

      if (!(tags.mask === true && (tags.remove === true || typeof tags.color === "string"))) return;

      const current = stack[stack.length - 1];
      if (current.name !== "title") return;
      const parent = stack[stack.length - 2];

      if (parent.name === "path" && parent.attrs.d) {
        const poly = geomService.svgPathToPolygon(parent.attrs.d);
        if (poly) {
          if (tags.remove) result.remove.push(poly);
          else (result.color[tags.color] ??= []).push(poly);
        }
      } else if (parent.name === "rect") {
        const x = Number.parseFloat(parent.attrs.x || "0");
        const y = Number.parseFloat(parent.attrs.y || "0");
        const w = Number.parseFloat(parent.attrs.width || "0");
        const h = Number.parseFloat(parent.attrs.height || "0");
        if (w > 0 && h > 0) {
          const poly = new Poly([new Vect(x, y), new Vect(x + w, y), new Vect(x + w, y + h), new Vect(x, y + h)]);
          if (tags.remove) result.remove.push(poly);
          else (result.color[tags.color] ??= []).push(poly);
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
