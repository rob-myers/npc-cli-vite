import { getDefaultTabs, type UiRegistryKey, uiRegistry } from "@npc-cli/ui-registry";
import { castDraft, type Draft } from "immer";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { createJSONStorage, devtools, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import "polyfill-crypto-methods"; // support non-https local dev on mobile

import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { HtmlPortalWrapper } from "./HtmlPortalsWrapper";
import type { UiInstanceMeta } from "./schema";
import type { WithImmer } from "./with-immer-type.d.ts";

export const uiStoreApi = {
  addUis({ metas, overwrite = true }: { metas: UiInstanceMeta[]; overwrite?: boolean }): void {
    // safety: on ui key rename/remove ignore persisted
    metas = metas.filter((meta) => meta.uiKey in uiRegistry);

    uiStore.setState((draft) => {
      for (const meta of metas) {
        // initial parse ensures e.g. Tabs `items` array
        // UiPortal will re-parse on updates and handle errors
        const result = uiRegistry[meta.uiKey].schema.safeParse(meta);
        if (overwrite || !draft.byId[meta.id]) {
          draft.byId[meta.id] = {
            meta: result.success ? result.data : meta,
            portal: castDraft(new HtmlPortalWrapper()),
            everSeen: !meta.parentId, // uis without parents are seen
          };
        }
      }
    });
  },
  clearUis(): void {
    uiStore.setState((draft) => {
      draft.byId = {};
    });
  },
  getAllUis() {
    const { byId } = uiStore.getState();
    return Object.values(byId).flatMap((ui) =>
      Array.isArray(ui.meta.items) ? [ui, ...ui.meta.items.map((id) => byId[id]).filter(Boolean)] : ui,
    );
  },
  /**
   * - For example `blog-1` in case `blog-0` and `blog-2` already exist.
   * - Prefix permits custom titles e.g. `tty-0`
   */
  getDefaultTitle(uiKey: UiRegistryKey, prefix = null as null | string) {
    const titleRegExp = new RegExp(`^${prefix ?? uiKey.toLowerCase()}-(\\d+)$`);
    const suffices = new Set(
      uiStoreApi
        .getAllUis()
        .flatMap(({ meta }) => (meta.uiKey === uiKey && titleRegExp.test(meta.title) ? Number(RegExp.$1) : [])),
    );
    return `${prefix ?? uiKey.toLowerCase()}-${[...Array(suffices.size + 1)].findIndex((_, i) => !suffices.has(i))}`;
  },
  getTabsInstances(excludeId?: string) {
    const { byId } = uiStore.getState();
    return Object.values(byId)
      .filter(({ meta }) => meta.uiKey === "Tabs" && meta.id !== excludeId)
      .map(({ meta }) => meta);
  },
  getSubUis(id: string) {
    const { byId } = uiStore.getState();
    return byId[id]?.meta.items?.map((subId) => byId[subId]).filter(Boolean) ?? [];
  },
  getUi(id: string): UiStoreByIdEntry | null {
    return uiStore.getState().byId[id] ?? null;
  },
  removeItem(itemId: string) {
    const ui = uiStore.getState().byId[itemId];
    if (!ui) return;

    for (const subItemId of ui.meta.items ?? []) {
      uiStoreApi.removeItem(subItemId);
    }

    uiStore.setState((draft) => {
      delete draft.byId[itemId];
    });

    ui.meta.onRemoveUi?.(ui.meta);
  },
  resetLayout() {
    uiStoreApi.clearUis();
  },
  setUiMeta(id: string, uiMetaDraft: (state: Draft<UiInstanceMeta>) => void) {
    uiStore.setState((draft) => void uiMetaDraft(draft.byId[id].meta));
  },
};

/**
 * Not persisted: contents should be determined by persisted layout.
 */
export const uiStoreFactory: () => UseBoundStore<WithImmer<StoreApi<UiStoreState>>> = () =>
  create<UiStoreState>()(
    immer(
      persist(
        devtools(
          (_set, _get): UiStoreState => ({
            byId: {},
            ready: false,
            persistedPanes: getDefaultPanes(),
          }),
          { name: "ui.store", anonymousActionType: "ui.store" },
        ),
        {
          name: "ui.storage",
          storage: createJSONStorage(() => localStorage),
          partialize: ({ persistedPanes }) => ({
            persistedPanes,
          }),
          onRehydrateStorage: () => (state) => {
            if (!state) return;

            const persistedPanes = state.persistedPanes;
            if (!(persistedPanes?.root && persistedPanes.toUi)) {
              console.warn("persistedPanes invalid: reverting to default", { invalidPersistedPanes: persistedPanes });
              state.persistedPanes = getDefaultPanes();
            }

            const rehydratedUis = Object.values(state.persistedPanes.toUi);
            for (const ui of rehydratedUis) {
              if (ui.disableOnMount === true) {
                ui.disabled = true;
              }
            }

            state.ready = true;
          },
        },
      ),
    ),
  );

// ⚠️ fix horrendous hmr issue onchange Tabs.tsx
// https://share.google/aimode/JBqFc4uwiV5h4EFyN
export let uiStore: ReturnType<typeof uiStoreFactory>;
if (import.meta.hot) {
  // Check if a store already exists in the HMR data object
  if (!import.meta.hot.data.__ZUSTAND_UI_STORE__) {
    import.meta.hot.data.__ZUSTAND_UI_STORE__ = uiStoreFactory();
  }
  uiStore = import.meta.hot.data.__ZUSTAND_UI_STORE__;
} else {
  uiStore = uiStoreFactory();
}

export type UiStoreState = {
  byId: { [id: string]: UiStoreByIdEntry };
  ready: boolean;
  persistedPanes: PersistedPanesLayout;
};

export type UiStoreByIdEntry = {
  meta: UiInstanceMeta;
  portal: HtmlPortalWrapper;
  everSeen: boolean;
};

export type PersistedPanesLayout = {
  root: PersistedPaneNode;
  toUi: { [uiId: string]: UiInstanceMeta };
};

export type PersistedPaneNode =
  | { type: "leaf"; id: number; uiId?: string }
  | {
      type: "split";
      id: number;
      vertical: boolean;
      children: PersistedPaneNode[];
      sizes?: number[];
      hiddenIds?: number[];
    };

function getDefaultPanes(): PersistedPanesLayout {
  const { tabs, toUi } = getDefaultTabs();
  return {
    root: {
      type: "split",
      id: 0,
      vertical: isTouchDevice(), // better for mobile
      children: tabs.map((meta, i) => ({ type: "leaf", id: i + 1, uiId: meta.id })),
      sizes: [100, 100],
    },
    toUi,
  };
}
