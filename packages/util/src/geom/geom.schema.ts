import z from "zod";

export const AffineTransformSchema = z.object({
  a: z.number(),
  b: z.number(),
  c: z.number(),
  d: z.number(),
  e: z.number(),
  f: z.number(),
});

export const BaseRectSchema = z.object({
  width: z.number(),
  height: z.number(),
});

export const CoordSchema = z.tuple([z.number(), z.number()]);

export const MetaSchema = z.record(z.string(), z.any());

export const PointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const RectSchema = BaseRectSchema.extend(PointSchema.shape);

export const SixTupleSchema = z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]);

export const Vector3LikeSchema = z.object({ x: z.number(), y: z.number(), z: z.number() });

export const TriangulationSchema = z.object({
  vs: z.array(PointSchema),
  tris: z.array(z.tuple([z.number(), z.number(), z.number()])),
});
