import { UiContext } from "@npc-cli/ui-sdk";
import { createFileRoute } from "@tanstack/react-router";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useThemeName } from "@npc-cli/theme";
import { ResponsiveGridLayout, type UiLayout } from "../components/ResponsiveGridLayout";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const theme = useThemeName();

  return (
    <UiContext.Provider value={{ theme }}>
      <ResponsiveGridLayout uiLayout={demo} />
    </UiContext.Provider>
  );
}

const demo: UiLayout = {
  layouts: {
    sm: [
      { i: "a", x: 0, y: 0, w: 1, h: 2, static: false },
      { i: "b", x: 1, y: 0, w: 3, h: 2, minW: 2, maxW: 4 },
      { i: "c", x: 4, y: 0, w: 2, h: 2 },
      { i: "d", x: 0, y: 2, w: 3, h: 3, isDraggable: true },
      { i: "e", x: 0, y: 4, w: 2, h: 1 },
      { i: "f", x: 6, y: 2, w: 3, h: 3, isDraggable: true },
    ],
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
    a: { uiKey: "Template" },
    b: { uiKey: "Template" },
    c: { uiKey: "Template" },
    d: { uiKey: "Blog" },
    e: { uiKey: "Global" },
    f: { uiKey: "Jsh" },
  },
};
