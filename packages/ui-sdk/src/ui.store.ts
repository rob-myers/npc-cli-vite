import { type UiRegistryKey, uiRegistry } from "@npc-cli/ui-registry";
import { castDraft } from "immer";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { HtmlPortalWrapper } from "./HtmlPortalsWrapper";
import type { UiInstanceMeta } from "./schema";
import type { WithImmer } from "./with-immer-type";

// 🚧 merge layout.store into ui.store
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
      devtools(
        (_set, _get): UiStoreState => ({
          byId: {},
        }),
        { name: "ui.store", anonymousActionType: "ui.store" },
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
};

export type UiStoreByIdEntry = {
  meta: UiInstanceMeta;
  portal: HtmlPortalWrapper;
};
