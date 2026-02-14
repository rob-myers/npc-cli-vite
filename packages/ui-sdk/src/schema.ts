import type { UiRegistryKey } from "@npc-cli/ui-registry";
import { keys } from "@npc-cli/util/legacy/generic";
import z from "zod";

/** Needed because `uiRegistryKeys` yields circular import dependency  */
const mirrored: Record<UiRegistryKey, true> = {
  Blog: true,
  Global: true,
  Jsh: true,
  MapEdit: true,
  Tabs: true,
  Template: true,
  World: true,
};

const FlatBaseUiMetaSchema = z.looseObject({
  /** Layout id */
  id: z.string(),
  /** Should UI render UiInstanceMenu instead? */
  customUiInstanceMenu: z.boolean().optional(),
  /** For pausing */
  disabled: z.boolean().optional(),
  /** For sub-uis e.g. individual tabs */
  parentId: z.string().optional(),
  /** e.g. tab header */
  title: z.string(),
  /** UI class identifier */
  uiKey: z.literal(keys(mirrored)),
});

export const BaseUiMetaSchema = z.looseObject({
  ...FlatBaseUiMetaSchema.shape,
  /** For sub-uis (Tabs) */
  items: z.array(z.string()).optional(),
});

export type UiInstanceMeta = z.infer<typeof BaseUiMetaSchema>;
