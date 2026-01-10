import type { ThemeName, ThemeState, ThemeStorageKey } from "@npc-cli/app/theme-types.ts";
import { tryLocalStorageGetParsed } from "@npc-cli/util/legacy/generic";
import { createContext } from "react";
import type { StorageValue } from "zustand/middleware/persist";

export const UiContext = createContext<UiContextValue>({
  theme: // initial value for future SSG
    tryLocalStorageGetParsed<StorageValue<ThemeState>>("theme-storage" satisfies ThemeStorageKey)
      ?.state.theme || "dark",
});

type UiContextValue = {
  theme: ThemeName;
};
