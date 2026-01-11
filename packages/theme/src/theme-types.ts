export type ThemeName = "light" | "dark";

export type ThemeState = {
  theme: ThemeName;
};
export type ThemeApi = {
  getName(): ThemeName;
  getOther(): ThemeName;
  setOther(): void;
};

export type ThemeStorageKey = "theme-storage";
