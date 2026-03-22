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
