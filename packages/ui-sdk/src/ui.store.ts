import { type UiRegistryKey, uiRegistry } from "@npc-cli/ui-registry";
import { castDraft } from "immer";
import * as portals from "react-reverse-portal";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { UiInstanceMeta } from "./schema";
import type { WithImmer } from "./with-immer-type";

/** Use class to keep immer happy */
export class HtmlPortalWrapper {
  portalNode: portals.HtmlPortalNode;
  constructor() {
    this.portalNode = portals.createHtmlPortalNode({
      attributes: { style: "width: 100%; height: 100%;" },
    });
  }
}

export const uiStoreApi = {
  addUis(...metas: UiInstanceMeta[]): void {
    uiStore.setState((draft) => {
      for (const meta of metas) {
        const result = uiRegistry[meta.uiKey].schema.safeParse(meta);
        draft.byId[meta.id] = {
          meta: result.success ? result.data : meta,
          portal: castDraft(new HtmlPortalWrapper()),
        };
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
};

/**
 * Not persisted: contents should be determined by persisted layout.
 */
export const uiStore: UseBoundStore<WithImmer<StoreApi<UiStoreState>>> = create<UiStoreState>()(
  immer(
    devtools(
      (_set, _get): UiStoreState => ({
        byId: {},
      }),
      { name: "ui.store", anonymousActionType: "ui.store" },
    ),
  ),
);

export type UiStoreState = {
  byId: { [id: string]: UiStoreByIdEntry };
};

export type UiStoreByIdEntry = {
  meta: UiInstanceMeta;
  portal: HtmlPortalWrapper;
};
