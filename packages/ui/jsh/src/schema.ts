import { BaseUiMetaSchema } from "@npc-cli/ui-sdk";
import z from "zod";

export const JshUiSchema = z.object({
  ...BaseUiMetaSchema.shape,
  sessionKey: z.templateLiteral(["tty-", z.number()]),
});

export type JshUiMeta = z.infer<typeof JshUiSchema>;
