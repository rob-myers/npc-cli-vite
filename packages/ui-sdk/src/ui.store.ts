import { type UiRegistryKey, uiRegistry } from "@npc-cli/ui-registry";
import { castDraft } from "immer";
import type { Layout } from "react-grid-layout";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { createJSONStorage, devtools, persist } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import { HtmlPortalWrapper } from "./HtmlPortalsWrapper";
import type { UiInstanceMeta } from "./schema";
import type { WithImmer } from "./with-immer-type";

export const uiStoreApi = {
  addUis({ metas, overwrite = true }: { metas: UiInstanceMeta[]; overwrite?: boolean }): void {
    uiStore.setState((draft) => {
      for (const meta of metas) {
        // initial parse ensures e.g. Tabs `items` array
        // UiPortal will re-parse on updates and handle errors
        const result = uiRegistry[meta.uiKey].schema.safeParse(meta);
        if (overwrite || !draft.byId[meta.id]) {
          draft.byId[meta.id] = {
            meta: result.success ? result.data : meta,
            portal: castDraft(new HtmlPortalWrapper()),
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
  getAllMetas() {
    return Object.values(uiStore.getState().byId).flatMap(({ meta }) => meta.items ?? meta);
  },
  /**
   * - For example `blog-1` in case `blog-0` and `blog-2` already exist.
   * - Prefix permits custom titles e.g. `tty-0`
   */
  getDefaultTitle(uiKey: UiRegistryKey, prefix = null as null | string) {
    const titleRegExp = new RegExp(`^${prefix ?? uiKey.toLowerCase()}-(\\d+)$`);
    const suffices = new Set(
      uiStoreApi
        .getAllMetas()
        .flatMap((meta) =>
          meta.uiKey === uiKey && titleRegExp.test(meta.title) ? Number(RegExp.$1) : [],
        ),
    );
    return `${prefix ?? uiKey.toLowerCase()}-${[...Array(suffices.size + 1)].findIndex((_, i) => !suffices.has(i))}`;
  },
  resetLayout() {
    uiStoreApi.clearUis();
    uiStoreApi.addUis({ metas: [getDefaultUiMeta()] });
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
            persistedItemToRect: {},
            persistedLayout: getDefaultLayout(),
          }),
          { name: "ui.store", anonymousActionType: "ui.store" },
        ),
        {
          name: "ui.storage",
          storage: createJSONStorage(() => localStorage),
          partialize: ({ persistedItemToRect, persistedLayout }) => ({
            persistedItemToRect,
            persistedLayout,
          }),
        },
      ),
    ),
  );

// ⚠️ fix horrendous hmr issue onchange Tabs.tsx
// https://share.google/aimode/JBqFc4uwiV5h4EFyN
export let uiStore: ReturnType<typeof uiStoreFactory>;
if (import.meta.hot) {
  // Check if a store already exists in the HMR data object
  if (!import.meta.hot.data.__ZUSTAND_STORE__) {
    import.meta.hot.data.__ZUSTAND_STORE__ = uiStoreFactory();
  }
  uiStore = import.meta.hot.data.__ZUSTAND_STORE__;
} else {
  uiStore = uiStoreFactory();
}

export type UiStoreState = {
  byId: { [id: string]: UiStoreByIdEntry };
  ready: boolean;
  /** Init only */
  persistedItemToRect: {
    [itemId: string]: { x: number; y: number; width: number; height: number };
  };
  /** Init only */
  persistedLayout: UiGridLayout;
};

export type UiStoreByIdEntry = {
  meta: UiInstanceMeta;
  portal: HtmlPortalWrapper;
};

export type UiGridLayout = {
  breakpoints: Record<"lg" | "sm", number>;
  cols: Record<"lg" | "sm", number>;
  /** Only one layout but cols still responsive */
  layouts: Record<"lg", Layout>;
  toUi: { [layoutKey: string]: UiInstanceMeta };
};

function getDefaultLayout(): UiGridLayout {
  const meta = getDefaultUiMeta();
  return {
    layouts: { lg: [{ i: meta.id, x: 12, y: 1, w: 2, h: 2 }] },
    breakpoints: { lg: 1200, sm: 768 },
    cols: { lg: 12, sm: 6 },
    toUi: { [meta.id]: meta },
  };
}

function getDefaultUiMeta(): UiInstanceMeta {
  const globalUiId = `ui-${crypto.randomUUID()}`;
  return { id: globalUiId, title: "global-0", uiKey: "Global" };
}
