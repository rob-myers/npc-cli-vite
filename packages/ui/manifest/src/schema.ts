import { BaseUiMetaSchema } from "@npc-cli/ui-sdk/schema";
import z from "zod";

export const ManifestUiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
  uiKey: z.literal("Manifest"),
  /** The World whose rooms, doors and npcs its characters name, and where its talks are had */
  worldKey: z.templateLiteral(["world-", z.number()]).default("world-0"),
  /** The text size, as a multiple */
  zoom: z.number().default(1),
  /** The columns' sizes, when wide enough to have them */
  split: z.array(z.number()).optional(),
  /** The character shown, or `talk/{key}` the conversation */
  entryKey: z.string().optional(),
});

export type ManifestUiMeta = z.infer<typeof ManifestUiMetaSchema>;
