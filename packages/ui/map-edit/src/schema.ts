import { BaseUiMetaSchema } from "@npc-cli/ui-sdk/schema";
import z from "zod";

export const MapEditUiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
  /** Can trigger sync across multiple instances */
  localVersion: z.number().optional().catch(0),
  /** The pane dragged shut, if either — unset, the inspector on touch devices */
  hidden: z.enum(["map", "inspector"]).nullable().optional(),
  /** The two panes' sizes, map then inspector */
  split: z.array(z.number()).optional(),
});

export type MapEditUiMeta = z.infer<typeof MapEditUiMetaSchema>;
