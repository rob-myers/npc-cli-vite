import svgPathParser from "svg-path-parser";
import { Poly } from "./poly.js";
import { Vect } from "./vect.js";

class GeomService {
  /**
   * Based on https://github.com/Phrogz/svg-path-to-polygons/blob/master/svg-path-to-polygons.js.
   * - Only supports straight lines i.e. M, L, H, V, Z.
   * - Expects a __single polygon__ with ≥ 0 holes.
   */
  svgPathToPolygon(svgPathString: string): Geom.Poly | null {
    const rings: Vect[][] = [];
    let ring: Vect[] = [];

    function add(x: number, y: number) {
      ring.push(new Vect(x, y));
    }

    svgPathParser.makeAbsolute(svgPathParser.parseSVG(svgPathString)).forEach((cmd) => {
      switch (cmd.code) {
        case "M":
          rings.push((ring = []));
          add(cmd.x || 0, cmd.y || 0);
          break;
        case "L":
        case "H":
        case "V":
        case "Z":
          add(cmd.x || 0, cmd.y || 0);
          break;
        default:
          throw Error(`svg command ${cmd.command} is not supported`);
      }
    });

    const polys = rings.map((ps) => new Poly(ps));

    if (polys.length === 0) {
      return null;
    } else if (polys.length === 1) {
      return polys[0];
    }

    // Largest polygon 1st
    polys.sort((a, b) => (a.rect.area < b.rect.area ? 1 : -1));
    return new Poly(
      polys[0].outline,
      polys.slice(1).map((poly) => poly.outline),
    );
  }
}

export const geomService = new GeomService();
