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

export const useThemeName = () => useStore(themeStore).theme;
