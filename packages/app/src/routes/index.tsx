import { createFileRoute } from "@tanstack/react-router";
import type { Layout } from "react-grid-layout";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { ResponsiveGridLayout } from "../components/ResponsiveGridLayout";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  return (
    <ResponsiveGridLayout
      breakpoints={demo.breakpoints}
      colsByBreakpoint={demo.cols}
      layoutByBreakpoint={demo.layouts}
    />
  );
}

const demo = {
  layouts: {
    sm: [
      { i: "a", x: 0, y: 0, w: 1, h: 2, static: false },
      { i: "b", x: 1, y: 0, w: 3, h: 2, minW: 2, maxW: 4 },
      { i: "c", x: 4, y: 0, w: 1, h: 2 },
      { i: "d", x: 0, y: 2, w: 4, h: 3, isDraggable: false },
      { i: "e", x: 1, y: 4, w: 1, h: 1 },
    ],
    lg: [
      { i: "a", x: 0, y: 0, w: 1, h: 2, static: false },
      { i: "b", x: 1, y: 0, w: 3, h: 2, minW: 2, maxW: 4 },
      { i: "c", x: 4, y: 0, w: 1, h: 2 },
      { i: "d", x: 0, y: 1, w: 4, h: 3, isDraggable: false },
      { i: "e", x: 0, y: 4, w: 1, h: 1 },
    ],
  } satisfies Partial<Record<"lg" | "sm", Layout>> as Partial<Record<"lg" | "sm", Layout>>,
  breakpoints: { lg: 1200, sm: 768 },
  cols: { lg: 12, sm: 6 },
};
