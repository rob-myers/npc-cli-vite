import { BaseUiMetaSchema } from "@npc-cli/ui-sdk/schema";
import z from "zod";

export const AudioUiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
  uiKey: z.literal("Audio"),
  /** Disabled, it is paused: its tab's button and the desk's own both switch it */
  disabled: BaseUiMetaSchema.shape.disabled.default(false),
  pausable: BaseUiMetaSchema.shape.pausable.default(true),
  enableOnRehydrate: BaseUiMetaSchema.shape.enableOnRehydrate.default(true),
  /** The sliders' values, over `ambienceDefaults` */
  config: z.record(z.string(), z.number()).optional(),
  /** The desk of controls, else the diagram of the engine's nodes */
  view: z.enum(["desk", "graph"]).optional(),
});

export type AudioUiMeta = z.infer<typeof AudioUiMetaSchema>;
