import svgPathParser from "svg-path-parser";
import { toPrecision } from "../legacy/generic.js";
import { Mat } from "./mat.js";
import { Poly } from "./poly.js";
import { Rect } from "./rect.js";
import { Vect } from "./vect.js";

class GeomService {
  /**
   * Angled rects are rotated about `(rect.x, rect.y)`
   */
  angledRectToPoly(input: Geom.AngledRect<Geom.Rect>): Geom.Poly {
    const poly = Poly.fromRect(input.baseRect);
    poly.translate(-input.baseRect.x, -input.baseRect.y);
    poly.applyMatrix(new Mat().setRotation(input.angle));
    poly.translate(input.baseRect.x, input.baseRect.y);
    return poly.fixOrientation(); // for inverse polyToAngledRect
  }

  /**
   * Create a new inset or outset version of polygon,
   * by cutting/unioning quads.
   * - assume outer points have anticlockwise orientation.
   * - assume holes have clockwise orientation.
   */
  createInset(polygon: Geom.Poly, amount: number) {
    if (amount === 0) return [polygon.clone()];
    polygon.cleanFinalReps(); // Required

    // Compute 4-gons inset or outset along edge normals by `amount`
    const [outerQuads, ...holesQuads] = [
      {
        ring: polygon.outline,
        inset: this.insetRing(polygon.outline, amount),
      },
      ...polygon.holes.map((ring) => ({
        ring,
        inset: this.insetRing(ring, amount),
      })),
    ].map(({ ring, inset }) =>
      ring.map(
        (_, i) =>
          new Poly([ring[i].clone(), inset[i], inset[(i + 1) % ring.length], ring[(i + 1) % ring.length].clone()]),
      ),
    );

    if (amount > 0) {
      // Inset
      return Poly.cutOut(outerQuads.concat(...holesQuads), [polygon.clone()]);
    } else {
      // Outset
      return Poly.union([polygon.clone()].concat(outerQuads, ...holesQuads));
    }
  }

  createOutset(polygon: Geom.Poly, amount: number) {
    return this.createInset(polygon, -amount);
  }

  /**
   * Get segment through center along 'x+'.
   */
  getAngledRectSeg({ angle, baseRect }: Geom.AngledRect<Geom.RectJson>) {
    const widthNormal = tempVect1.set(Math.cos(angle), Math.sin(angle));
    const heightNormal = tempVect2.set(-Math.sin(angle), Math.cos(angle));
    const src = new Vect(baseRect.x, baseRect.y).addScaled(heightNormal, 0.5 * baseRect.height);
    return {
      seg: [src, src.clone().addScaled(widthNormal, baseRect.width)],
      normal: heightNormal.clone().precision(6),
    };
  }

  getDeltaDirection(direction: Geom.Direction, delta: 0 | 1 | 2 | 3): Geom.Direction {
    return ((direction + delta) % 4) as Geom.Direction;
  }

  getFlippedDirection(direction: Geom.Direction, axis: "x" | "y"): Geom.Direction {
    if (axis === "x") {
      return direction % 2 === 0 ? ((2 - direction) as Geom.Direction) : direction;
    } else {
      return direction % 2 === 1 ? ((4 - direction) as Geom.Direction) : direction;
    }
  }

  /**
   * Compute intersection of two infinite lines i.e.
   * 1. `lambda x. p0 + x * d0`.
   * 2. `lambda x. p1 + x * d1`.
   *
   * If they intersect non-degenerately,
   * return parameter solving (1) else `null`.
   *
   */
  getLinesIntersect(p0: Geom.VectJson, d0: Geom.VectJson, p1: Geom.VectJson, d1: Geom.VectJson): number | null {
    /**
     * Recall normal_0 is (-d0.y, d0.x).
     * No intersection if directions d0, d1 approx. parallel, ignoring colinear.
     */
    if (Math.abs(-d0.y * d1.x + d0.x * d1.y) < 0.0001) {
      return null;
    }
    return (d1.x * (p1.y - p0.y) - d1.y * (p1.x - p0.x)) / (d0.y * d1.x - d1.y * d0.x);
  }

  /**
   * Compute intersection of line segments
   * `p0 -- p1` and `q0 -- q1`
   *
   * If they intersect, return `lambda` ∊ [0, 1] s.t. intersection is
   * `p0 + (p1 - p0) * lambda`, else return `null`.
   */
  getLineSegsIntersection(
    p0: Geom.VectJson,
    p1: Geom.VectJson,
    q0: Geom.VectJson,
    q1: Geom.VectJson,
    ignoreColinear?: boolean,
  ) {
    const dpx = p1.x - p0.x,
      dpy = p1.y - p0.y,
      dqx = q1.x - q0.x,
      dqy = q1.y - q0.y,
      /** The z component of cross product `dp ｘ dq` */
      z = -dqx * dpy + dpx * dqy;

    let s: number, t: number;

    if (z === 0) {
      if (ignoreColinear === true) return null;
      /**
       * Line segs are parallel, so both have non-normalized
       * normal (-dpy, dpx). For colinearity they must have
       * the same dot product w.r.t latter.
       */
      if (p0.x * -dpy + p0.y * dpx === q0.x * -dpy + q0.y * dpx) {
        /**
         * Check if p0 or p1 lies between both q0 and q1.
         */
        t = dqx * dqx + dqy * dqy;
        s = (p0.x - q0.x) * dqx + (p0.y - q0.y) * dqy;
        if (0 <= s && s <= t) {
          return s / t;
        }
        s = (p1.x - q0.x) * dqx + (p1.y - q0.y) * dqy;
        if (0 <= s && s <= t) {
          return s / t;
        }
      }
      return null;
    }

    s = (-dpy * (p0.x - q0.x) + dpx * (p0.y - q0.y)) / z;
    t = (dqx * (p0.y - q0.y) - dqy * (p0.x - q0.x)) / z;
    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) {
      return t;
    } else {
      return null;
    }
  }

  getThreeRotationY(dy: number, dx: number) {
    return -Math.atan2(dy, dx) - Math.PI / 2;
  }

  /**
   * Inset/outset a ring by amount.
   */
  private insetRing(ring: Vect[], amount: number): Vect[] {
    const poly = new Poly(ring);
    const tangents = poly.tangents.outer;
    const edges = ring.map((p, i): [Vect, Vect] => [
      p.clone().translate(amount * -tangents[i].y, amount * tangents[i].x),
      ring[(i + 1) % ring.length].clone().translate(amount * -tangents[i].y, amount * tangents[i].x),
    ]);
    return edges.map((edge, i) => {
      const nextIndex = (i + 1) % edges.length;
      const nextEdge = edges[nextIndex];
      const lambda = geomService.getLinesIntersect(edge[1], tangents[i], nextEdge[0], tangents[nextIndex]);
      return lambda
        ? edge[1].translate(lambda * tangents[i].x, lambda * tangents[i].y)
        : Vect.average([edge[1], nextEdge[0]]); // Fallback
    });
  }

  isDirectionChar(input: any): input is (typeof directionChars)[number] {
    return directionChars.includes(input);
  }

  /**
   * Join disjoint triangulations
   */
  joinTriangulations(triangulations: Geom.Triangulation[]): Geom.Triangulation & { tOffsets: number[] } {
    const vs: Vect[] = [];
    const tris: [number, number, number][] = [];
    const tOffsets: number[] = [];
    let vOffset = 0;

    for (const decomp of triangulations) {
      vs.push(...decomp.vs);
      tOffsets.push(tris.length);
      tris.push(...decomp.tris.map((tri) => tri.map((x) => (x += vOffset)) as [number, number, number]));
      vOffset += decomp.vs.length;
    }
    return { vs, tris, tOffsets };
  }

  /**
   * Convert a polygonal rectangle back into a `Rect` and `angle` s.t.
   * - rectangle needs to be rotated about its "top-left point" `(x, y)`.
   * - rectangle `width` is greater than or equal to its `height`.
   */
  polyToAngledRect(poly: Geom.Poly): Geom.AngledRect<Geom.Rect> {
    if (poly.outline.length !== 4) {
      return { angle: 0, baseRect: poly.rect }; // Fallback to AABB
    }

    const ps = poly.outline;
    const w = tempVect1.copy(ps[1]).sub(ps[0]).length;
    const h = tempVect2.copy(ps[2]).sub(ps[1]).length;

    if (w >= h) {
      return {
        baseRect: new Rect(ps[0].x, ps[0].y, w, h),
        angle: Math.atan2(tempVect1.y, tempVect1.x),
      };
    } else {
      return {
        baseRect: new Rect(ps[1].x, ps[1].y, h, w),
        angle: Math.atan2(tempVect2.y, tempVect2.x),
      };
    }
  }

  precision2d(v: Geom.VectJson, precision = 4) {
    v.x = Number(v.x.toFixed(precision));
    v.y = Number(v.y.toFixed(precision));
    return v;
  }

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

  /**
   * Round a 3D vector to a specified number of decimal places.
   */
  toPrecisionV3(input: { x: number; y: number; z: number }, dp?: number): { x: number; y: number; z: number } {
    input.x = toPrecision(input.x, dp);
    input.y = toPrecision(input.y, dp);
    input.z = toPrecision(input.z, dp);
    return input;
  }

  triangulationToPolys(decomp: Geom.Triangulation) {
    return decomp.tris.map(([u, v, w]) => new Poly([decomp.vs[u], decomp.vs[v], decomp.vs[w]]));
  }
}

export const geomService = new GeomService();

const tempVect1 = new Vect();
const tempVect2 = new Vect();

/**
 * Aligned to `Geom.Direction`.
 */
export const directionChars = ["n", "e", "s", "w"] as const;
