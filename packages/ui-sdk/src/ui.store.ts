import type { UiRegistryKey } from "@npc-cli/ui-registry";
import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { UiInstanceMeta } from "./schema";

export const uiStoreApi = {
  getAllMetas() {
    return Object.values(uiStore.getState().metaById).flatMap((meta) => meta.items ?? meta);
  },

  /** e.g. `jsh-1` where `1` is first unused natural number */
  getDefaultTitle(uiKey: UiRegistryKey) {
    const titleRegExp = new RegExp(`^${uiKey.toLowerCase()}-(\\d+)$`);
    const suffices = new Set(
      uiStoreApi
        .getAllMetas()
        .flatMap((meta) =>
          meta.uiKey === uiKey && titleRegExp.test(meta.title) ? Number(RegExp.$1) : [],
        ),
    );
    return `${uiKey.toLowerCase()}-${[...Array(suffices.size + 1)].findIndex((_, i) => !suffices.has(i))}`;
  },
};

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
  metaById: { [id: string]: UiInstanceMeta };
};
