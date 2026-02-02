import type { UiRegistryKey } from "@npc-cli/ui-registry";
import { castDraft } from "immer";
import type * as portals from "react-reverse-portal";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { UiInstanceMeta } from "./schema";
import type { WithImmer } from "./with-immer-type";

/** Use class to keep immer happy */
class HtmlPortalWrapper {
  portalNode: portals.HtmlPortalNode;
  constructor(portalNode: portals.HtmlPortalNode) {
    this.portalNode = portalNode;
  }
}

export const uiStoreApi = {
  addUiPortal(id: string, portalNode: portals.HtmlPortalNode) {
    uiStore.setState((draft) => {
      draft.portalById[id] = castDraft(new HtmlPortalWrapper(portalNode));
    });
  },
  getAllMetas() {
    return Object.values(uiStore.getState().metaById).flatMap((meta) => meta.items ?? meta);
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
};

/**
 * Not persisted: contents should be determined by persisted layout.
 */
export const uiStore: UseBoundStore<WithImmer<StoreApi<UiStoreState>>> = create<UiStoreState>()(
  immer(
    devtools(
      (_set, _get) => ({
        metaById: {},
        portalById: {},
      }),
      { name: "ui.store", anonymousActionType: "ui.store" },
    ),
  ),
);

export type UiStoreState = {
  metaById: { [id: string]: UiInstanceMeta };
  // portalById: { [id: string]: portals.HtmlPortalNode };
  portalById: { [id: string]: HtmlPortalWrapper };
};
