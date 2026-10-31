import { BaseUiMetaSchema } from "@npc-cli/ui-sdk/schema";
import z from "zod";

export const AudioUiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
  uiKey: z.literal("Audio"),
  /** Disabled, its steps are paused: its tab's button and the desk's own both switch it */
  disabled: BaseUiMetaSchema.shape.disabled.default(false),
  pausable: BaseUiMetaSchema.shape.pausable.default(true),
  enableOnRehydrate: BaseUiMetaSchema.shape.enableOnRehydrate.default(true),
  /** The sliders moved from `audioDefaults`. One unreadable is dropped, as left by an older desk */
  config: z.record(z.string(), z.number()).optional().catch(undefined),
  /** The `audioConfigVersion` `config` was saved against. Another drops it */
  configVersion: z.number().optional(),
  /** Which set of footsteps plays. One unreadable is dropped */
  stepSet: z.string().optional().catch(undefined),
  /** The desk of controls, else the diagram of the engine's nodes */
  view: z.enum(["desk", "graph"]).optional(),
});

export type AudioUiMeta = z.infer<typeof AudioUiMetaSchema>;
