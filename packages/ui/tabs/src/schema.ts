import { BaseUiMetaSchema } from "@npc-cli/ui-sdk";
import z from "zod";

export const TabsUiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
  disabled: z.boolean().default(true),
  items: z.array(z.string()).default([]),
  currentTabId: z.string().optional(),
});

export type TabsUiMeta = z.infer<typeof TabsUiMetaSchema>;
