import { BaseUiMetaSchema } from "@npc-cli/ui-sdk/schema";
import z from "zod";

export const ManifestUiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
  uiKey: z.literal("Manifest"),
  /** The World it says lines in, and whose rooms, doors and npcs its entries name */
  worldKey: z.templateLiteral(["world-", z.number()]).default("world-0"),
  /** The text size, as a multiple */
  zoom: z.number().default(1),
  /** The three columns' sizes, when wide enough to have them */
  split: z.array(z.number()).optional(),
  /** The sections of the card folded away */
  folded: z.array(z.string()).default([]),
  /** The entry shown */
  entryKey: z.string().optional(),
});

export type ManifestUiMeta = z.infer<typeof ManifestUiMetaSchema>;
