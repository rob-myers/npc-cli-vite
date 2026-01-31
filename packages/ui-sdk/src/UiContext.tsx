import type { ThemeName, ThemeState, ThemeStorageKey } from "@npc-cli/theme";
import type { UiRegistry } from "@npc-cli/ui-registry";
import { tryLocalStorageGetParsed } from "@npc-cli/util/legacy/generic";
import { createContext } from "react";
import type { StorageValue } from "zustand/middleware/persist";
import type { UseBoundStore } from "zustand/react";
import type { StoreApi } from "zustand/vanilla";
import type { UiInstanceMeta } from "./schema";
import { type UiStoreState, uiStore } from "./ui.store";
import type { WithImmer } from "./with-immer-type";

export const UiContext = createContext<UiContextValue>({
  layoutApi: {
    overrideContextMenu: noOp,
    resetLayout: noOp,
  },
  theme: // initial value for future SSG
    tryLocalStorageGetParsed<StorageValue<ThemeState>>("theme-storage" satisfies ThemeStorageKey)
      ?.state.theme || "dark",
  uiRegistry: {} as UiRegistry,
  uiStore,
});

export type UiContextValue = {
  layoutApi: {
    overrideContextMenu(opts: OverrideContextMenuOpts): void;
    resetLayout(): void;
  };
  theme: ThemeName;
  uiRegistry: UiRegistry;
  uiStore: UseBoundStore<WithImmer<StoreApi<UiStoreState>>>;
};

export type AddUiItemOpts = {
  itemId: string;
  uiMeta: UiInstanceMeta;
  gridRect: { x: number; y: number; width: number; height: number };
};

export type OverrideContextMenuOpts = {
  refObject: React.RefObject<HTMLElement | null>;
  addItem(addItemOpts: AddUiItemOpts): void;
};

function noOp() {}
