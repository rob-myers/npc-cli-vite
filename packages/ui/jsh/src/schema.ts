import { BaseUiMetaSchema } from "@npc-cli/ui-sdk/schema";
import z from "zod";

export const JshUiSchema = z.object({
  ...BaseUiMetaSchema.shape,
  // enabled initially and on rehydrate
  disabled: BaseUiMetaSchema.shape.disabled.default(false),
  pausable: BaseUiMetaSchema.shape.pausable.default(true),
  enableOnRehydrate: BaseUiMetaSchema.shape.enableOnRehydrate.default(true),
  sessionBootedAt: z.number().optional(),
  sessionKey: z.templateLiteral(["tty-", z.number()]),
  env: z.record(z.string(), z.unknown()).default({}),
  /** Its jobs panel, beside the terminal */
  jobs: z
    .object({
      shown: z.boolean().default(true),
      at: z.enum(["top", "bottom", "left", "right"]).default("bottom"),
      /** Its share of the Jsh along `at`'s axis */
      size: z.number().default(0.35),
    })
    .prefault({}),
});

export type JshUiMeta = z.infer<typeof JshUiSchema>;
