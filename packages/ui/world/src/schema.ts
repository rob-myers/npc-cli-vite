import { BaseUiMetaSchema } from "@npc-cli/ui-sdk/schema";
import z from "zod";

// Avoid HMR issue
const defaultMapKey: typeof import("./const").defaultMapKey = "301-only";
const defaultThemeKey: typeof import("./const").defaultThemeKey = "light-theme";

export const WorldUiSchema = z.object({
  ...BaseUiMetaSchema.shape,
  uiKey: z.literal("World"),
  disabled: BaseUiMetaSchema.shape.disabled.default(true),
  // disable World when refresh page
  disableOnRehydrate: BaseUiMetaSchema.shape.disableOnRehydrate.default(true),
  worldKey: z.templateLiteral(["world-", z.number()]),
  mapKey: z.string().default(defaultMapKey),
  themeKey: z.string().default(defaultThemeKey),
  // prefer left because performance tool on right
  menuPosition: BaseUiMetaSchema.shape.menuPosition.default("left"),
});

export type WorldUiMeta = z.infer<typeof WorldUiSchema>;
