import { create, useStore } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export const themeApi: ThemeState["api"] = {
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
      api: themeApi,
    }),
    {
      name: "theme-storage",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

type ThemeState = {
  theme: ThemeName;
  readonly api: {
    getName(): ThemeName;
    getOther(): ThemeName;
    setOther(): void;
  };
};

type ThemeName = "light" | "dark";

export const useThemeName = () => useStore(themeStore).theme;
