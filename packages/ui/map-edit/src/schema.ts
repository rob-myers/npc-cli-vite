import { BaseUiMetaSchema } from "@npc-cli/ui-sdk/schema";
import z from "zod";

export const MapEditUiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
  /** Can trigger sync across multiple instances */
  localVersion: z.number().optional().catch(0),
});

export type MapEditUiMeta = z.infer<typeof MapEditUiMetaSchema>;
