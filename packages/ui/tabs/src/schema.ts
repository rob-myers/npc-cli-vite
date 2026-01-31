import { BaseUiMetaSchema } from "@npc-cli/ui-sdk";
import z from "zod";

export const TabsUiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
  items: z.array(BaseUiMetaSchema).default([]),
  currentTabId: z.string().optional(),
});

export type TabsUiMeta = z.infer<typeof TabsUiMetaSchema>;
