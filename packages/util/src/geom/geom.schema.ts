import z from "zod";
import { Poly } from "./poly.js";
import { Rect } from "./rect.js";
import { Vect } from "./vect.js";

export const AffineTransformSchema = z.object({
  a: z.number(),
  b: z.number(),
  c: z.number(),
  d: z.number(),
  e: z.number(),
  f: z.number(),
});

export const CoordSchema = z.tuple([z.number(), z.number()]);

export const MetaSchema = z.record(z.string(), z.any());

export const VectSchema = z.instanceof(Vect);
export const PointJsonSchema = z.object({
  x: z.number(),
  y: z.number(),
});
export const pointCodec = z.codec(PointJsonSchema, VectSchema, {
  decode: (pointJson) => Vect.from(pointJson),
  encode: (point) => point.json,
});

export const RectSchema = z.instanceof(Rect);
export const RectJsonSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export const rectCodec = z.codec(RectJsonSchema, RectSchema, {
  decode: (json) => Rect.fromJson(json),
  encode: (rect) => rect.json,
});

export const SixTupleSchema = z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]);

export const Vector3LikeSchema = z.object({ x: z.number(), y: z.number(), z: z.number() });

export const TriangulationSchema = z.object({
  vs: z.array(pointCodec),
  tris: z.array(z.tuple([z.number(), z.number(), z.number()])),
});

export const GeoJsonPolygonSchema = z.object({
  type: z.literal("Polygon"),
  /**
   * The 1st array defines the _outer polygon_,
   * the others define non-nested _holes_.
   */
  coordinates: z.array(z.array(CoordSchema)),
  meta: z.record(z.string(), z.any()),
});

export type GeoJsonPolygon = z.infer<typeof GeoJsonPolygonSchema>;

export const PolySchema = z.instanceof(Poly);

export const polyCodec = z.codec(GeoJsonPolygonSchema, PolySchema, {
  decode: (geoJson) => Poly.from(geoJson),
  encode: (poly) => poly.geoJson,
});
