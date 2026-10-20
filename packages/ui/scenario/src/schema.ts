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
  /** A scenario's phases shown as a grid, or as a machine */
  phasesView: z.enum(["grid", "machine"]).default("grid"),
  /** The machine view's height in pixels, as last resized */
  machineHeight: z.number().optional(),
  /** The machine view's pan and zoom, as last left: until then it centres the start */
  machineViewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }).optional(),
  /** The entry shown: `scenario/{key}`, `character/{slug}` or `talk/{key}` */
  entryKey: z.string().optional(),
});

export type ScenarioUiMeta = z.infer<typeof ScenarioUiMetaSchema>;

/** What a scenario's card keeps in the panel's meta */
export type CardPrefs = Pick<ScenarioUiMeta, "phasesView" | "machineHeight" | "machineViewport">;
