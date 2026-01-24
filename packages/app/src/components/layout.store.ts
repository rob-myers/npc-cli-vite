import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { UiGridLayout } from "./UiGrid";

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

export const demoLayout: UiGridLayout = {
  layouts: {
    lg: [
      { i: "a", x: 0, y: 0, w: 1, h: 2, static: false },
      { i: "b", x: 1, y: 0, w: 3, h: 2, minW: 2, maxW: 4 },
      { i: "c", x: 4, y: 0, w: 2, h: 2 },
      { i: "d", x: 0, y: 2, w: 3, h: 3, isDraggable: true },
      { i: "e", x: 0, y: 4, w: 2, h: 1 },
      { i: "f", x: 6, y: 2, w: 3, h: 3 },
    ],
  },
  breakpoints: { lg: 1200, sm: 768 },
  cols: { lg: 12, sm: 6 },
  toUi: {
    a: { layoutId: "a", uiKey: "Template" },
    b: { layoutId: "b", uiKey: "Template" },
    c: { layoutId: "c", uiKey: "Template" },
    d: { layoutId: "d", uiKey: "Blog" },
    e: { layoutId: "e", uiKey: "Global" },
    f: { layoutId: "f", uiKey: "Jsh" },
  },
};
