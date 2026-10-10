import { BaseUiMetaSchema } from "@npc-cli/ui-sdk/schema";
import z from "zod";

export const AudioUiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
  uiKey: z.literal("Audio"),
  /** The sliders' values, over `ambienceDefaults` */
  config: z.record(z.string(), z.number()).optional(),
  /** The desk of controls, else the diagram of the engine's nodes */
  view: z.enum(["desk", "graph"]).optional(),
});

export type AudioUiMeta = z.infer<typeof AudioUiMetaSchema>;
