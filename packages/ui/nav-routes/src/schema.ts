import { BaseUiMetaSchema } from "@npc-cli/ui-sdk/schema";
import z from "zod";

export const NavRoutesUiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
  uiKey: z.literal("NavRoutes"),
  /** The World whose map, navmesh and npcs this draws */
  worldKey: z.templateLiteral(["world-", z.number()]).default("world-0"),
  /** The npcs followed on the map: none, unless chosen */
  npcKeys: z.array(z.string()).default([]),
  /** The track new points go to, as `trackId(name, role)` */
  selected: z.string().nullable().default(null),
  /** Tracks not drawn, and tracks not to be edited, by `trackId` */
  hidden: z.array(z.string()).default([]),
  locked: z.array(z.string()).default([]),
  /** Layers of the map */
  show: z
    .object({
      nav: z.boolean().default(true),
      labels: z.boolean().default(true),
      obstacles: z.boolean().default(true),
      grid: z.boolean().default(false),
    })
    .prefault({}),
});

export type NavRoutesUiMeta = z.infer<typeof NavRoutesUiMetaSchema>;
export type NavMapLayer = keyof NavRoutesUiMeta["show"];

/** A track within a route. Route names and roles are free text, so the separator is one neither has */
export const trackId = (name: string, role: string) => `${name}\u0000${role}`;
