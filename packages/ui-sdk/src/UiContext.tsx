import type { ThemeName, ThemeState, ThemeStorageKey } from "@npc-cli/theme";
import type { UiRegistry } from "@npc-cli/ui-registry";
import { tryLocalStorageGetParsed } from "@npc-cli/util/legacy/generic";
import { createContext } from "react";
import type { LayoutItem } from "react-grid-layout";
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
  appendLayoutItems(items: LayoutItem[]): void;
  fitItem(id: string): void;
  minimizeItem(id: string): void;
  getUiGridRect(id: string): { x: number; y: number; w: number; h: number } | null;
  overrideContextMenu(opts: OverrideContextMenuOpts): void;
  removeLayoutItem(id: string): void;
  screenToGrid(clientX: number, clientY: number): { x: number; y: number } | null;
};

export type AddUiItemOpts = {
  uiMeta: UiInstanceMeta;
  gridRect: { x: number; y: number; width: number; height: number };
};

export type OverrideContextMenuOpts = {
  refObject: React.RefObject<HTMLElement | null>;
  addItem(opts: { uiMeta: UiInstanceMeta }): void;
};

export function getFallbackLayoutApi(): LayoutApi {
  return {
    appendLayoutItems: () => {
      console.warn("appendLayoutItems called before UiGrid layoutApi was set");
    },
    fitItem() {
      console.warn("fitItem called before UiGrid layoutApi was set");
    },
    minimizeItem() {
      console.warn("minimizeItem called before UiGrid layoutApi was set");
    },
    getUiGridRect() {
      console.warn("getUiGridRect called before UiGrid layoutApi was set");
      return null;
    },
    overrideContextMenu: () => {
      console.warn("overrideContextMenu called before UiGrid layoutApi was set");
    },
    removeLayoutItem() {
      console.warn("removeLayoutItem called before UiGrid layoutApi was set");
    },
    screenToGrid() {
      console.warn("screenToGrid called before UiGrid layoutApi was set");
      return null;
    },
  };
}
