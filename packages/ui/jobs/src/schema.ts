import { BaseUiMetaSchema } from "@npc-cli/ui-sdk/schema";
import z from "zod";

export const JobsUiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
});

export type JobsUiMeta = z.infer<typeof JobsUiMetaSchema>;
