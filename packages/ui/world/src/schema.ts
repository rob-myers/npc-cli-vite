import { BaseUiMetaSchema } from "@npc-cli/ui-sdk";
import z from "zod";

export const WorldUiSchema = z.object({
  ...BaseUiMetaSchema.shape,
  disabled: z.boolean().default(true), // 🚧 default to false
  worldKey: z.templateLiteral(["world-", z.number()]),
});

export type WorldUiMeta = z.infer<typeof WorldUiSchema>;
