import { StarShipGeomorphKeySchema } from "@npc-cli/media/starship-symbol";
import {
  MetaSchema,
  pointCodec,
  RectJsonSchema,
  rectCodec,
  SixTupleSchema,
  Vector3LikeSchema,
} from "@npc-cli/util/geom";
import z from "zod";

const GmRoomIdSchema = z.object({
  grKey: z.string(),
  gmId: z.number(),
  roomId: z.number(),
});

const BaseDecorSchema = z.object({
  key: z.string(),
  meta: MetaSchema.and(GmRoomIdSchema),
  bounds2d: rectCodec,
  updatedAt: z.number().optional(),
  src: StarShipGeomorphKeySchema.optional(),
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
  center: pointCodec,
});

export const DecorCuboidSchema = BaseDecorSchema.extend({
  type: z.literal("cuboid"),
  center: Vector3LikeSchema,
  transform: SixTupleSchema,
});
export const DecorCuboidDefSchema = BaseDecorDefSchema.extend(RectJsonSchema.shape).extend({
  type: z.literal("cuboid"),
  baseY: z.number(),
  height3d: z.number(),
  transform: SixTupleSchema.optional(),
});

export const DecorPointSchema = BaseDecorSchema.extend({
  type: z.literal("point"),
  x: z.number(),
  y: z.number(),
  orient: z.number(),
  meta: MetaSchema.and(GmRoomIdSchema).and(z.object({ img: z.string().optional() })),
});
export const DecorPointDefSchema = BaseDecorDefSchema.extend({
  type: z.literal("point"),
  x: z.number(),
  y: z.number(),
  img: z.string().optional(),
  orient: z.number().optional(),
  y3d: z.number().optional(),
});

export const DecorQuadSchema = BaseDecorSchema.extend({
  type: z.literal("quad"),
  transform: SixTupleSchema,
  center: pointCodec,
  det: z.number(),
  meta: MetaSchema.and(GmRoomIdSchema).and(z.object({ img: z.string() })),
});
export const DecorQuadDefSchema = BaseDecorDefSchema.extend(RectJsonSchema.shape).extend({
  type: z.literal("quad"),
  img: z.string(),
  color: z.string().optional(),
  transform: SixTupleSchema.optional(),
  y3d: z.number().optional(),
});

export const DecorDecalSchema = BaseDecorSchema.extend({
  type: z.literal("decal"),
  transform: SixTupleSchema,
  center: pointCodec,
  det: z.number(),
  meta: MetaSchema.and(GmRoomIdSchema).and(z.object({ img: z.string() })),
});

export const DecorRectSchema = BaseDecorSchema.extend({
  type: z.literal("rect"),
  points: z.array(pointCodec),
  center: pointCodec,
  angle: z.number(),
});
export const DecorRectDefSchema = BaseDecorDefSchema.extend(RectJsonSchema.shape).extend({
  type: z.literal("rect"),
  angle: z.number().optional(),
});

export const DecorSchema = z.discriminatedUnion("type", [
  DecorCircleSchema,
  DecorCuboidSchema,
  DecorPointSchema,
  DecorQuadSchema,
  DecorDecalSchema,
  DecorRectSchema,
]);
export type Decor = z.infer<typeof DecorSchema>;

export const DecorDefSchema = z.discriminatedUnion("type", [
  DecorCircleDefSchema,
  DecorCuboidDefSchema,
  DecorPointDefSchema,
  DecorQuadDefSchema,
  DecorRectDefSchema,
]);
export type DecorDef = z.infer<typeof DecorDefSchema>;
