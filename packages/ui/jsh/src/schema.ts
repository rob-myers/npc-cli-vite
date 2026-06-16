import { default_profile } from "@npc-cli/cli/jsh/profiles";
import { BaseUiMetaSchema } from "@npc-cli/ui-sdk/schema";
import z from "zod";

export const JshUiSchema = z.object({
  ...BaseUiMetaSchema.shape,
  sessionKey: z.templateLiteral(["tty-", z.number()]),
  env: z.record(z.string(), z.unknown()).default({}),
  profile: z.string().default(default_profile),
});

export type JshUiMeta = z.infer<typeof JshUiSchema>;
