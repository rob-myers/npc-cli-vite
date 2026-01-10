export type ThemeName = "light" | "dark";

export type ThemeState = {
  theme: ThemeName;
  readonly api: {
    getName(): ThemeName;
    getOther(): ThemeName;
    setOther(): void;
  };
};

export type ThemeStorageKey = "theme-storage";
