import { BaseUiMetaSchema } from "@npc-cli/ui-sdk/schema";
import z from "zod";

export const BlogUiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
  /** Key of the shown page e.g. `test-mdx`; `getBlogPage` handles a stale one */
  pageKey: z.string().optional().catch(undefined),
});

export type BlogUiMeta = z.infer<typeof BlogUiMetaSchema>;
