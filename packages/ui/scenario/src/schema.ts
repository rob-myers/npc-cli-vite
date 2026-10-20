import { BaseUiMetaSchema } from "@npc-cli/ui-sdk/schema";
import z from "zod";

export const ScenarioUiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
  uiKey: z.literal("Scenario"),
  /** The World whose rooms, doors and npcs its characters name, and where its talks are had */
  worldKey: z.templateLiteral(["world-", z.number()]).default("world-0"),
  /** The tty scenarios are run in: its World is the one shown */
  sessionKey: z.string().optional(),
  /** The text size, as a multiple */
  zoom: z.number().default(1),
  /** The columns' sizes, when wide enough to have them */
  split: z.array(z.number()).optional(),
  /** The entry shown: `scenario/{key}`, `character/{slug}` or `talk/{key}` */
  entryKey: z.string().optional(),
});

export type ScenarioUiMeta = z.infer<typeof ScenarioUiMetaSchema>;
