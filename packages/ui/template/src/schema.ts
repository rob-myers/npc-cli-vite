import { BaseUiMetaSchema } from "@npc-cli/ui-sdk";
import z from "zod";

export const TemplateUiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
});

export type TemplateUiMeta = z.infer<typeof TemplateUiMetaSchema>;
