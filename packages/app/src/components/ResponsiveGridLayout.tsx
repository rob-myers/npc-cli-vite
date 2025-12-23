import { motion } from "motion/react";
import { GridLayout, type Layout, useContainerWidth, useResponsiveLayout } from "react-grid-layout";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { cn } from "@npc-cli/util";
import { useRef, useState } from "react";
import TestMdx from "../blog/test-mdx.mdx";
import { themeApi, useThemeName } from "../stores/theme.store";

export function ResponsiveGridLayout({ layoutByBreakpoint, breakpoints, colsByBreakpoint }: Props) {
  const layouts = useRef(layoutByBreakpoint);

  const { width, containerRef } = useContainerWidth();

  const { layout, cols, setLayouts } = useResponsiveLayout({
    width,
    breakpoints,
    cols: colsByBreakpoint,
    layouts: layouts.current,
    compactType: "horizontal",
    onBreakpointChange(_bp, _cols) {
      // Fixes overflow on slow/sudden change
      setLayouts((layouts.current = { ...layouts.current }));
    },
  });

  const theme = useThemeName();
  // disable initial animation until fade in
  const [animateItems, setAnimateItems] = useState(false);
  const [resizing, setResizing] = useState(false);

  return (
    <motion.div
      ref={containerRef}
      className="w-full overflow-auto"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.3 } }}
      onAnimationComplete={() => setAnimateItems(true)}
    >
      <GridLayout
        className={cn(
          !animateItems && "[&_.react-grid-item]:transition-none!",
          resizing && "select-none",
          "border text-on-background/60 [&_.react-resizable-handle::after]:border-on-background!",
        )}
        width={width}
        gridConfig={{
          cols, // 🔔 not mentioned in documentation
          rowHeight: 80,
        }}
        layout={layout}
        onResizeStart={() => {
          setResizing(true);
        }}
        onResizeStop={(layout) => {
          console.log("onResizeStop", layout);
          layouts.current.lg = layouts.current.sm = layout;
          setResizing(false);
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
            onPointerDown={themeApi.setOther}
          >
            {theme}
          </button>
        </div>
      </GridLayout>
    </motion.div>
  );
}

type Props = {
  /** Initial */
  layoutByBreakpoint: Partial<Record<"lg" | "sm", Layout>>;
  breakpoints: { lg: number; sm: number };
  colsByBreakpoint: { lg: number; sm: number };
};
