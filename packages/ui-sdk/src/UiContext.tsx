import type { ThemeName, ThemeState, ThemeStorageKey } from "@npc-cli/theme";
import { tryLocalStorageGetParsed } from "@npc-cli/util/legacy/generic";
import { createContext } from "react";
import type { StorageValue } from "zustand/middleware/persist";
import { uiStore } from "./ui.store";

export const UiContext = createContext<UiContextValue>({
  layoutApi: {
    resetLayout() {},
  },
  theme: // initial value for future SSG
    tryLocalStorageGetParsed<StorageValue<ThemeState>>("theme-storage" satisfies ThemeStorageKey)
      ?.state.theme || "dark",
  uiStore,
});

type UiContextValue = {
  layoutApi: {
    resetLayout(): void;
  };
  theme: ThemeName;
  uiStore: typeof uiStore;
};
