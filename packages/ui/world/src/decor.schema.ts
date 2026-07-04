import { MetaSchema, pointCodec, RectJsonSchema, rectCodec, SixTupleSchema, VectJsonSchema } from "@npc-cli/util/geom";
import z from "zod";

const GmRoomIdSchema = z.object({
  grKey: z.templateLiteral([z.literal("g"), z.number(), z.literal("r"), z.number()]),
  gmId: z.number(),
  roomId: z.number(),
});

const BaseDecorSchema = z.object({
  key: z.string(),
  meta: MetaSchema.and(GmRoomIdSchema).and(
    z.object({
      /**
       * For optional refinements e.g.
       * - point-tests against obstacle polygons modelled as decor rects
       */
      refinedOutline: z.array(VectJsonSchema).optional(),
    }),
  ),
  /** 2D bounds in XZ plane (for decor quads this is pre-tilting) */
  bounds: rectCodec,
  updatedAt: z.number().optional(),
});

const BaseDecorDefSchema = z.object({
  key: z.string(),
  meta: MetaSchema.optional(),
});

export const DecorCircleSchema = BaseDecorSchema.extend({
  type: z.literal("circle"),
  radius: z.number(),
  center: pointCodec,
});

export const DecorCircleDefSchema = BaseDecorDefSchema.extend({
  type: z.literal("circle"),
  radius: z.number(),
  center: VectJsonSchema,
});

export const DecorPointSchema = BaseDecorSchema.extend({
  type: z.literal("point"),
  x: z.number(),
  y: z.number(),
  orient: z.number(),
  transform: SixTupleSchema.default([1, 0, 0, 1, 0, 0]),
  meta: MetaSchema.and(GmRoomIdSchema).and(z.object({ img: z.string().optional() })),
  det: z.number().default(1),
});

export const DecorPointDefSchema = BaseDecorDefSchema.extend({
  type: z.literal("point"),
  x: z.number(),
  y: z.number(),
  img: z.string().optional(),
  orient: z.number().optional(),
  transform: SixTupleSchema.optional(),
  y3d: z.number().optional(),
});

export const DecorQuadSchema = BaseDecorSchema.extend({
  type: z.literal("quad"),
  transform: SixTupleSchema,
  center: pointCodec,
  topCenter: pointCodec,
  meta: MetaSchema.and(GmRoomIdSchema).and(z.object({ img: z.string() })),
  det: z.number().default(1),
});

export const DecorQuadDefSchema = BaseDecorDefSchema.extend({
  type: z.literal("quad"),
  img: z.string(),
  color: z.string().optional(),
  transform: SixTupleSchema.optional(),
  y3d: z.number().optional(),
});

export const DecorRectSchema = BaseDecorSchema.extend({
  type: z.literal("rect"),
  points: z.array(pointCodec),
  center: pointCodec,
  angle: z.number(),
});

export const DecorRectDefSchema = BaseDecorDefSchema.extend(RectJsonSchema.shape).extend({
  type: z.literal("rect"),
  /** Radians */
  angle: z.number().optional(),
});

export const DecorSchema = z.discriminatedUnion("type", [
  DecorCircleSchema,
  DecorPointSchema,
  DecorQuadSchema,
  DecorRectSchema,
]);
export type Decor = z.infer<typeof DecorSchema>;

export const DecorDefSchema = z.discriminatedUnion("type", [
  DecorCircleDefSchema,
  DecorPointDefSchema,
  DecorQuadDefSchema,
  DecorRectDefSchema,
]);
export type DecorDef = z.infer<typeof DecorDefSchema>;
