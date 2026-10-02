import { BaseUiMetaSchema } from "@npc-cli/ui-sdk/schema";
import z from "zod";

export const TemplateUiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
  /** The pane dragged shut, if either: the process leaders, or the library */
  hidden: z.enum(["processes", "library"]).nullable().default(null),
  /** The two panes' sizes, processes then library */
  split: z.array(z.number()).optional(),
});

export type TemplateUiMeta = z.infer<typeof TemplateUiMetaSchema>;
