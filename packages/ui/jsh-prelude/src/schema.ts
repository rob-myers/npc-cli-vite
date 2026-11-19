import { BaseUiMetaSchema } from "@npc-cli/ui-sdk/schema";
import z from "zod";

export const JshPreludeUiMetaSchema = z.object({
  ...BaseUiMetaSchema.shape,
  uiKey: z.literal("JshPrelude"),
  /** The World whose prelude it shows */
  worldKey: z.templateLiteral(["world-", z.number()]).default("world-0"),
});

export type JshPreludeUiMeta = z.infer<typeof JshPreludeUiMetaSchema>;
