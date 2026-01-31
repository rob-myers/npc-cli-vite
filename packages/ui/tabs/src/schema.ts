import { BaseUiMetaSchema } from "@npc-cli/ui-sdk";
import z from "zod";

export const TabUiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
  title: z.string().default("My tab"),
});

export const TabsUiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
  items: z.array(TabUiMetaSchema).default([]),
  currentTabId: z.string().optional(),
});

export type TabsUiMeta = z.infer<typeof TabsUiMetaSchema>;
export type TabUiMeta = z.infer<typeof TabUiMetaSchema>;
