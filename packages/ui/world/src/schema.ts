import { BaseUiMetaSchema } from "@npc-cli/ui-sdk";
import z from "zod";

export const WorldUiSchema = z.object({
  ...BaseUiMetaSchema.shape,
  worldKey: z.templateLiteral(["world-", z.number()]),
});

export type WorldUiMeta = z.infer<typeof WorldUiSchema>;
