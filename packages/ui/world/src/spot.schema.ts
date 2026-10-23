import z from "zod";

/** Sent by the dev server once `public/spot/*.json` are rewritten */
export const spotsChangedEvent = "spots-changed";

/** Sent by the dev server as it starts making them, `{ running: true }`, and as it ends */
export const spotsGeneratingEvent = "spots-generating";

/** Spots made first win a merge: a fill is dropped for a door spot beside it, never the reverse */
export const spotKinds = ["doable", "door", "corner", "cover", "wall", "decor", "fill"] as const;
export const SpotKindSchema = z.enum(spotKinds);
export type SpotKind = z.infer<typeof SpotKindSchema>;

/** Each kind's colour, wherever spots are drawn: the Decorator, and the World's overlay */
export const spotKindInk: Record<SpotKind, string> = {
  doable: "#a970ff",
  door: "#f0a030",
  corner: "#40c0e0",
  cover: "#40d080",
  wall: "#8090a0",
  decor: "#e070b0",
  fill: "#c0c040",
};

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
  /**
   * Spots whose region its region may see, needing no door. Not here, nor in `always` or `via`: never seen.
   * Further than `radius` is unknown, so may — see `docs/perception.md`
   */
  sight: z.array(z.number()).default([]),
  /** Spots whose region its region always sees: every line between is clear */
  always: z.array(z.number()).default([]),
  /** `[doorIds, spotIds]`: spots it may see once all those doors are open */
  via: z.array(z.tuple([z.array(z.number()), z.array(z.number())])).default([]),
  /** Cover only: spots whose region cannot see it fully crouched */
  crouchSafe: z.array(z.number()).default([]),
  /** Doable only: radians either side of its facing seen by whoever sits or lies there. Without one it is stood at */
  doArc: z.number().optional(),
  /** Doable only: spots seen by whoever sits or lies there, from its point within `doArc` */
  doSight: z.array(z.number()).default([]),
  /** Doable only: `[doorIds, spotIds]`, as `doSight` once all those doors are open */
  doVia: z.array(z.tuple([z.array(z.number()), z.array(z.number())])).default([]),
});
export type Spot = z.infer<typeof SpotSchema>;

export const SpotsFileSchema = z.object({
  gmKey: z.string(),
  /** Of the layout and the code making them: unchanged, they are not made again */
  layoutHash: z.number(),
  angles: z.number(),
  radius: z.number(),
  /** Metres: a spot stands for the floor this near it */
  regionRadius: z.number().default(0),
  /** Rooms which may see each other: `[roomId, roomId, ...doorIds]`, lesser first */
  rooms: z.array(z.array(z.number())).default([]),
  /** By hull door, the spots whose region may see its opening: `[doorId, [spotId, ...doorIds][]]` */
  hull: z.array(z.tuple([z.number(), z.array(z.array(z.number()))])).default([]),
  spots: z.array(SpotSchema),
});
export type SpotsFile = z.infer<typeof SpotsFileSchema>;
