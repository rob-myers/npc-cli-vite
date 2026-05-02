import type { ThemeName, ThemeState, ThemeStorageKey } from "@npc-cli/theme";
import type { UiRegistry } from "@npc-cli/ui-registry";
import { tryLocalStorageGetParsed } from "@npc-cli/util/legacy/generic";
import { createContext } from "react";
import type { StorageValue } from "zustand/middleware/persist";
import type { UiInstanceMeta } from "./schema";

export const UiContext = createContext<UiContextValue>({
  layoutApi: getFallbackLayoutApi(),
  theme: // initial value for future SSG
    tryLocalStorageGetParsed<StorageValue<ThemeState>>("theme-storage" satisfies ThemeStorageKey)?.state.theme ||
    "dark",
  uiRegistry: {} as UiRegistry,
  uiStore: {} as typeof import("./ui.store").uiStore,
  uiStoreApi: {} as typeof import("./ui.store").uiStoreApi,
});

export type { ThemeName } from "@npc-cli/theme";

export type UiContextValue = {
  layoutApi: LayoutApi;
  theme: ThemeName;
  uiRegistry: UiRegistry;
  uiStore: typeof import("./ui.store").uiStore;
  uiStoreApi: typeof import("./ui.store").uiStoreApi;
};

export type LayoutApi = {
  overrideContextMenu(opts: OverrideContextMenuOpts): void;
};

export type OverrideContextMenuOpts = {
  refObject: React.RefObject<HTMLElement | null> | { getBoundingClientRect(): DOMRect };
  addItem(opts: { uiMeta: UiInstanceMeta }): void;
};

export function getFallbackLayoutApi(): LayoutApi {
  return {
    overrideContextMenu: () => {
      console.warn("overrideContextMenu called before layoutApi was set");
    },
  };
}
