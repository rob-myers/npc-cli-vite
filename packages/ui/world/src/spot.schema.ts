import z from "zod";

/** Sent by the dev server once `public/spot/*.json` are rewritten */
export const spotsChangedEvent = "spots-changed";

/** Spots made first win a merge: a fill is dropped for a door spot beside it, never the reverse */
export const spotKinds = ["doable", "door", "corner", "cover", "wall", "decor", "fill"] as const;
export const SpotKindSchema = z.enum(spotKinds);
export type SpotKind = z.infer<typeof SpotKindSchema>;

/** A place an npc might stand, in its geomorph's coords — see `docs/spots.md` */
export const SpotSchema = z.object({
  id: z.number(),
  kind: SpotKindSchema,
  x: z.number(),
  y: z.number(),
  roomId: z.number().nullable(),
  /** Radians in the xy plane: into the room off a wall or obstacle, towards a door, a doable's `orient` */
  facing: z.number().optional(),
  /** Metres to the nearest occluder at each of `angles` directions from `+x`, stood, doors shut */
  depth: z.array(z.number()),
  /** Spots in sight, stood, doors shut */
  sees: z.array(z.number()),
  /** Spots in sight through one door, once it opens: `[spotId, doorId]` */
  seesVia: z.array(z.tuple([z.number(), z.number()])),
  seesDoors: z.array(z.number()),
  /** Ids within `nearRadius`. `decor` and `doables` index `layout.decor` */
  near: z.object({
    doors: z.array(z.number()),
    decor: z.array(z.number()),
    doables: z.array(z.number()),
    obstacles: z.array(z.number()),
  }),
  /** What it was made for */
  ref: z.object({ doorId: z.number(), decorId: z.number(), obstacleId: z.number() }).partial().optional(),
  /** Cover only: spots in `sees` which lose sight of it once it fully crouches */
  crouchHidden: z.array(z.number()).optional(),
});
export type Spot = z.infer<typeof SpotSchema>;

export const SpotsFileSchema = z.object({
  gmKey: z.string(),
  /** Of the layout and the code making them: unchanged, they are not made again */
  layoutHash: z.number(),
  angles: z.number(),
  radius: z.number(),
  spots: z.array(SpotSchema),
});
export type SpotsFile = z.infer<typeof SpotsFileSchema>;
