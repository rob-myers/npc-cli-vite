import { BaseUiMetaSchema } from "@npc-cli/ui-sdk/schema";
import z from "zod";
import { defaultProfile } from "./profiles";

export const JshUiSchema = z.object({
  ...BaseUiMetaSchema.shape,
  sessionKey: z.templateLiteral(["tty-", z.number()]),
  env: z.record(z.string(), z.unknown()).default({}),
  profile: z.string().default(defaultProfile),
});

export type JshUiMeta = z.infer<typeof JshUiSchema>;
