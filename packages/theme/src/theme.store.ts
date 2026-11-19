import { createContext, useContext } from "react";
import { create, useStore } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { ThemeApi, ThemeName, ThemeState, ThemeStorageKey } from "./theme-types";

export const themeApi: ThemeApi = {
  getName(this: ThemeState) {
    return themeStore.getState().theme;
  },
  getOther(this: ThemeState) {
    return themeStore.getState().theme === "dark" ? "light" : "dark";
  },
  setOther() {
    return themeStore.setState({ theme: themeApi.getOther() });
  },
};

const defaultThemeName: ThemeName = "dark";

export const themeStore = create<ThemeState>()(
  persist(
    (_set, _get): ThemeState => ({
      theme: defaultThemeName,
    }),
    {
      name: "theme-storage" satisfies ThemeStorageKey,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/** A tab's own theme, overriding the page's within it */
export const TabThemeContext = createContext<null | ThemeName>(null);

/** The theme shown here: its tab's, else the page's */
export function useThemeName() {
  const tabTheme = useContext(TabThemeContext);
  const pageTheme = useStore(themeStore).theme;
  return tabTheme ?? pageTheme;
}
