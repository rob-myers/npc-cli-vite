import type { UiRegistryKey } from "@npc-cli/ui-registry";
import { keys } from "@npc-cli/util/legacy/generic";
import z from "zod";

/** Needed because `uiRegistryKeys` yields circular import dependency  */
const mirrored: Record<UiRegistryKey, true> = {
  Blog: true,
  Global: true,
  Jsh: true,
  Tabs: true,
  Template: true,
  World: true,
};

export const BaseUiMetaSchema = z.looseObject({
  /** Layout id */
  id: z.string(),
  title: z.string(),
  uiKey: z.literal(keys(mirrored)),
});

export type UiInstanceMeta = z.infer<typeof BaseUiMetaSchema>;
