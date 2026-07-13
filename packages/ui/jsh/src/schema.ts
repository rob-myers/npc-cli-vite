import { BaseUiMetaSchema } from "@npc-cli/ui-sdk/schema";
import z from "zod";

export const JshUiSchema = z.object({
  ...BaseUiMetaSchema.shape,
  // enabled initially and on rehydrate
  disabled: BaseUiMetaSchema.shape.disabled.default(false),
  enableOnRehydrate: BaseUiMetaSchema.shape.enableOnRehydrate.default(true),
  sessionKey: z.templateLiteral(["tty-", z.number()]),
  env: z.record(z.string(), z.unknown()).default({}),
});

export type JshUiMeta = z.infer<typeof JshUiSchema>;
