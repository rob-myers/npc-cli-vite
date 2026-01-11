import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { UiGridLayout } from "./UiGridLayout";

/**
 * Used to persist layout
 */
export const layoutStore = create<LayoutState>()(
  persist(
    (_set, _get): LayoutState => ({
      itemToRect: {},
      ready: false,
      uiLayout: null,
    }),
    {
      name: "layout-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: ({ itemToRect, uiLayout }) => ({
        itemToRect,
        uiLayout,
      }),
    },
  ),
);

type LayoutState = {
  itemToRect: { [itemId: string]: { x: number; y: number; width: number; height: number } };
  ready: boolean;
  uiLayout: UiGridLayout | null;
};
