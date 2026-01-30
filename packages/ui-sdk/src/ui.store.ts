import type { UiRegistryKey } from "@npc-cli/ui-registry";
import { keys } from "@npc-cli/util/legacy/generic";
import z from "zod";
import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

/**
 * Not persisted: contents should be determined by persisted layout.
 */
export const uiStore = create<UiStoreState>()(
  immer(
    devtools(
      (_set, _get) => ({
        metaById: {},
      }),
      { name: "ui-store", anonymousActionType: "ui-store" },
    ),
  ),
);

export type UiStoreState = {
  metaById: { [layoutId: string]: UiInstanceMeta };
};

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
  layoutId: z.string(),
  uiKey: z.literal(keys(mirrored)),
});

export type UiInstanceMeta = z.infer<typeof BaseUiMetaSchema>;
