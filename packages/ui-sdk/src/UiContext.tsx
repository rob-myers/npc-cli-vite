import type { ThemeName, ThemeState, ThemeStorageKey } from "@npc-cli/theme";
import type { UiRegistry } from "@npc-cli/ui-registry";
import { tryLocalStorageGetParsed } from "@npc-cli/util/legacy/generic";
import { createContext } from "react";
import type { StorageValue } from "zustand/middleware/persist";
import type { UseBoundStore } from "zustand/react";
import type { StoreApi } from "zustand/vanilla";
import type { UiInstanceMeta } from "./schema";
import { type UiStoreState, uiStore, uiStoreApi } from "./ui.store";
import type { WithImmer } from "./with-immer-type";

// 🚧 simplify
export const UiContext = createContext<UiContextValue>({
  layoutApi: {
    addItem: noOp,
    getUiGridRect: () => null,
    overrideContextMenu: noOp,
    resetLayout: noOp,
  },
  theme: // initial value for future SSG
    tryLocalStorageGetParsed<StorageValue<ThemeState>>("theme-storage" satisfies ThemeStorageKey)
      ?.state.theme || "dark",
  uiRegistry: {} as UiRegistry,
  uiStore,
  uiStoreApi,
});

export type UiContextValue = {
  layoutApi: {
    addItem(opts: AddUiItemOpts): void;
    getUiGridRect(id: string): { x: number; y: number; width: number; height: number } | null;
    overrideContextMenu(opts: OverrideContextMenuOpts): void;
    resetLayout(): void;
  };
  theme: ThemeName;
  uiRegistry: UiRegistry;
  uiStore: UseBoundStore<WithImmer<StoreApi<UiStoreState>>>;
  uiStoreApi: typeof uiStoreApi;
};

export type AddUiItemOpts = {
  uiMeta: UiInstanceMeta;
  gridRect: { x: number; y: number; width: number; height: number };
};

export type OverrideContextMenuOpts = {
  refObject: React.RefObject<HTMLElement | null>;
  addItem(opts: { uiMeta: UiInstanceMeta }): void;
};

function noOp() {}
