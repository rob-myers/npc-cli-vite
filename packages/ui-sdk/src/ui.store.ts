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
        // initial parse ensures e.g. `tabs.items` array
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
    uiStoreApi.addUis({
      metas: [{ id: `ui-${crypto.randomUUID()}`, title: "global-0", uiKey: "Global" }],
    });
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
            persistedLayout: getDemoLayout(),
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

export function getDemoLayout(): UiGridLayout {
  return {
    layouts: {
      lg: [
        { i: "a", x: 0, y: 0, w: 1, h: 2, static: false },
        { i: "b", x: 1, y: 0, w: 3, h: 2, minW: 2, maxW: 4 },
        { i: "c", x: 4, y: 0, w: 2, h: 2 },
        { i: "d", x: 0, y: 2, w: 3, h: 3, isDraggable: true },
        { i: "e", x: 0, y: 4, w: 2, h: 1 },
        { i: "f", x: 6, y: 2, w: 3, h: 3 },
      ],
    },
    breakpoints: { lg: 1200, sm: 768 },
    cols: { lg: 12, sm: 6 },
    toUi: {
      a: { id: "a", title: "template-0", uiKey: "Template" },
      b: { id: "b", title: "template-1", uiKey: "Template" },
      c: { id: "c", title: "template-2", uiKey: "Template" },
      d: { id: "d", title: "blog-0", uiKey: "Blog" },
      e: { id: "e", title: "global-0", uiKey: "Global" },
      f: { id: "f", title: "jsh-0", uiKey: "Jsh" },
    },
  };
}
