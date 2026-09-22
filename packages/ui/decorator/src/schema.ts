import { BaseUiMetaSchema } from "@npc-cli/ui-sdk/schema";
import z from "zod";

export const DecoratorUiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
  uiKey: z.literal("Decorator"),
  /** The World whose map, navmesh and npcs this draws */
  worldKey: z.templateLiteral(["world-", z.number()]).default("world-0"),
  /** The npcs followed on the map: none, unless chosen */
  npcKeys: z.array(z.string()).default([]),
  /** The sidebar: its width, and whether it is out */
  sidebarWidth: z.number().default(208),
  sidebarOpen: z.boolean().default(true),
  /** Layers of the map */
  show: z
    .object({
      nav: z.boolean().default(true),
      labels: z.boolean().default(true),
      obstacles: z.boolean().default(true),
      grid: z.boolean().default(false),
      /** The map's own decor, faint, for context */
      static: z.boolean().default(true),
    })
    .prefault({}),
});

export type DecoratorUiMeta = z.infer<typeof DecoratorUiMetaSchema>;
export type NavMapLayer = keyof DecoratorUiMeta["show"];
