import { BaseUiMetaSchema } from "@npc-cli/ui-sdk";
import z from "zod";

export const MapEditUiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
});

export type MapEditUiMeta = z.infer<typeof MapEditUiMetaSchema>;
