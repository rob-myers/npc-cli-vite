import type { ThemeName, ThemeState, ThemeStorageKey } from "@npc-cli/theme";
import { tryLocalStorageGetParsed } from "@npc-cli/util/legacy/generic";
import { createContext } from "react";
import type { StorageValue } from "zustand/middleware/persist";
import type { UseBoundStore } from "zustand/react";
import type { StoreApi } from "zustand/vanilla";
import { type UiStoreState, uiStore } from "./ui.store";
import type { WithImmer } from "./with-immer-type";

export const UiContext = createContext<UiContextValue>({
  layoutApi: {
    openContextMenu: noOp,
    resetLayout: noOp,
  },
  theme: // initial value for future SSG
    tryLocalStorageGetParsed<StorageValue<ThemeState>>("theme-storage" satisfies ThemeStorageKey)
      ?.state.theme || "dark",
  uiStore,
});

export type UiContextValue = {
  layoutApi: {
    openContextMenu(refObject: React.RefObject<HTMLElement | null>): void;
    resetLayout(): void;
  };
  theme: ThemeName;
  uiStore: UseBoundStore<WithImmer<StoreApi<UiStoreState>>>;
};

function noOp() {}
