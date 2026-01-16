import type { ThemeName, ThemeState, ThemeStorageKey } from "@npc-cli/theme";
import { tryLocalStorageGetParsed } from "@npc-cli/util/legacy/generic";
import { createContext } from "react";
import type { StorageValue } from "zustand/middleware/persist";

export const UiContext = createContext<UiContextValue>({
  theme: // initial value for future SSG
    tryLocalStorageGetParsed<StorageValue<ThemeState>>("theme-storage" satisfies ThemeStorageKey)
      ?.state.theme || "dark",
  layoutApi: {
    resetLayout() {},
  },
});

type UiContextValue = {
  theme: ThemeName;
  layoutApi: {
    resetLayout(): void;
  };
};
