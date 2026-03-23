import { BaseUiMetaSchema } from "@npc-cli/ui-sdk";
import z from "zod";
import { emptyMapKey } from "./const";

export const WorldUiSchema = z.object({
  ...BaseUiMetaSchema.shape,
  disabled: z.boolean().default(true),
  worldKey: z.templateLiteral(["world-", z.number()]),
  mapKey: z.string().default(emptyMapKey),
  // prefer left because performance tool on right
  menuPosition: BaseUiMetaSchema.shape.menuPosition.default("left"),
});

export type WorldUiMeta = z.infer<typeof WorldUiSchema>;
