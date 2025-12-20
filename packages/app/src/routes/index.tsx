import { createFileRoute } from "@tanstack/react-router";
import { GridLayout, type Layout, useContainerWidth, useResponsiveLayout } from "react-grid-layout";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { cn } from "@npc-cli/util";
import TestMdx from "../blog/test-mdx.mdx";
import { themeApi, useThemeName } from "../stores/theme.store";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  const { width, containerRef, mounted } = useContainerWidth();
  const theme = useThemeName();

  const {
    layout, // Current layout for active breakpoint
    cols, // Column count for current breakpoint
    // layouts, // All layouts by breakpoint
    // breakpoint, // Current active breakpoint ('lg', 'md', etc.)
    // setLayoutForBreakpoint,
    // setLayouts,
    // sortedBreakpoints,
  } = useResponsiveLayout({
    width,
    breakpoints: demo.breakpoints,
    cols: demo.cols,
    layouts: demo.layouts,
    // compactType: "vertical",
    compactType: "horizontal",
    // onBreakpointChange: (bp, cols) => console.log(`Now at ${bp} (${cols} cols)`),
    // onLayoutChange(layout, allLayouts) {
    //   console.log({ layout });
    // },
  });

  return (
    <div ref={containerRef} className="w-full mb-16">
      {mounted && (
        <GridLayout
          className="border text-on-background [&_.react-resizable-handle::after]:border-on-background!"
          width={width}
          gridConfig={{
            cols, // 🔔 not mentioned in documentation
          }}
          layout={layout}
          onResizeStop={(layout) => {
            console.log("onResizeStop", layout);
          }}
          onDragStop={(layout) => {
            console.log("onDragStop", layout);
          }}
        >
          {["a", "b", "c"].map((key) => (
            <div key={key} className="border flex items-center justify-center">
              {key}
            </div>
          ))}
          <div
            key="d"
            className={cn(
              theme === "dark" && "prose-invert",
              "prose prose-sm overflow-auto border p-4",
            )}
          >
            <TestMdx />
          </div>
          <div key="e" className="border p-4 flex items-center">
            <button
              type="button"
              className="cursor-pointer border rounded px-4 py-1"
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
    lg: [
      { i: "a", x: 0, y: 0, w: 1, h: 2, static: false },
      { i: "b", x: 1, y: 0, w: 3, h: 2, minW: 2, maxW: 4 },
      { i: "c", x: 4, y: 0, w: 1, h: 2 },
      { i: "d", x: 0, y: 1, w: 4, h: 4, isDraggable: false },
    ],
  } satisfies Partial<Record<"lg" | "sm", Layout>> as Partial<Record<"lg" | "sm", Layout>>,
  breakpoints: { lg: 1200, sm: 768 },
  cols: { lg: 12, sm: 6 },
};
