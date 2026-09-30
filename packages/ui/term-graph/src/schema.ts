import { BaseUiMetaSchema } from "@npc-cli/ui-sdk/schema";
import z from "zod";

export const TermGraphUiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
  uiKey: z.literal("TermGraph"),
  /** The behaviour node shown, else the first */
  nodeKey: z.string().optional(),
});

export type TermGraphUiMeta = z.infer<typeof TermGraphUiMetaSchema>;
