import { createFileRoute } from "@tanstack/react-router";
import { GridLayout, type Layout, useContainerWidth, useResponsiveLayout } from "react-grid-layout";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { cn } from "@npc-cli/util";
import { useRef } from "react";
import TestMdx from "../blog/test-mdx.mdx";
import { themeApi, useThemeName } from "../stores/theme.store";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { width, containerRef, mounted } = useContainerWidth();
  const theme = useThemeName();
  const layouts = useRef(demo.layouts);

  const {
    layout, // Current layout for active breakpoint
    cols, // Column count for current breakpoint
    // layouts, // All layouts by breakpoint
    // breakpoint, // Current active breakpoint ('lg', 'md', etc.)
    // setLayoutForBreakpoint,
    setLayouts,
    // sortedBreakpoints,
  } = useResponsiveLayout({
    width,
    breakpoints: demo.breakpoints,
    cols: demo.cols,
    layouts: layouts.current,
    // compactType: "vertical",
    compactType: "horizontal",
    onBreakpointChange(_bp, _cols) {
      // Fixes overflow on slow/sudden change
      setLayouts((layouts.current = { ...layouts.current }));
    },
  });

  return (
    <div ref={containerRef}>
      {mounted && (
        <GridLayout
          className="border text-on-background/60 [&_.react-resizable-handle::after]:border-on-background!"
          width={width}
          gridConfig={{
            cols, // 🔔 not mentioned in documentation
            rowHeight: 80,
          }}
          layout={layout}
          onResizeStop={(layout) => {
            console.log("onResizeStop", layout);
            layouts.current.lg = layouts.current.sm = layout;
          }}
          onDragStop={(layout) => {
            console.log("onDragStop", layout);
            layouts.current.lg = layouts.current.sm = layout;
          }}
        >
          {["a", "b", "c"].map((key) => (
            <div key={key} className="border rounded flex items-center justify-center">
              {key}
            </div>
          ))}
          <div
            key="d"
            className={cn(
              theme === "dark" && "prose-invert",
              "prose max-w-[unset] overflow-auto border p-4 leading-[1.4]",
            )}
          >
            <TestMdx />
          </div>
          <div key="e" className="border p-4 flex items-center">
            <button
              type="button"
              className="cursor-pointer border rounded px-4 py-1 bg-button"
              onPointerUp={themeApi.setOther}
            >
              {theme}
            </button>
          </div>
        </GridLayout>
      )}
    </div>
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
