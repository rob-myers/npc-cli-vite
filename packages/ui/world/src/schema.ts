import { BaseUiMetaSchema } from "@npc-cli/ui-sdk/schema";
import z from "zod";

// Avoid HMR issue
// const emptyMapKey: typeof import("./const").emptyMapKey = "empty-map";
const defaultMapKey: typeof import("./const").defaultMapKey = "small-map-0";

export const WorldUiSchema = z.object({
  ...BaseUiMetaSchema.shape,
  disabled: z.boolean().default(true),
  worldKey: z.templateLiteral(["world-", z.number()]),
  mapKey: z.string().default(defaultMapKey),
  // prefer left because performance tool on right
  menuPosition: BaseUiMetaSchema.shape.menuPosition.default("left"),
});

export type WorldUiMeta = z.infer<typeof WorldUiSchema>;
