import { motion } from "motion/react";
import { GridLayout, type Layout, useContainerWidth, useResponsiveLayout } from "react-grid-layout";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { Tty } from "@npc-cli/cli";
/**
 * Each keyed module contains JS generators and functions.
 * - They will be converted into shell functions.
 * - We also store them directly in session.
 * - Example usage `import util`
 */
import * as modules from "@npc-cli/cli/jsh/modules";
import { uiRegistry } from "@npc-cli/ui__registry";
import { cn } from "@npc-cli/util";
import { useRef, useState } from "react";
import TestMdx from "../blog/test-mdx.mdx";
import { themeApi, useThemeName } from "../stores/theme.store";

// 🚧 remove component hard-coding
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

  // 🚧 useStateRef and useUpdate
  // disable initial animation until fade in
  const [animateItems, setAnimateItems] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [dragging, setDragging] = useState(false);

  // 🚧 packages/ui/themer
  const theme = useThemeName();

  return (
    <motion.div
      ref={containerRef}
      className="w-full overflow-auto h-full border border-white"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: 0.3 } }}
      onAnimationComplete={() => setAnimateItems(true)}
    >
      <GridLayout
        className={cn(
          !animateItems && "[&_.react-grid-item]:transition-none!",
          (resizing || dragging) && "select-none",
          "text-on-background/60 [&_.react-resizable-handle::after]:border-on-background!",
        )}
        width={width}
        gridConfig={{
          cols,
          rowHeight: 80,
          // margin: [16, 16],
        }}
        layout={layout}
        onResizeStart={() => {
          setResizing(true);
        }}
        onResizeStop={(layout) => {
          layouts.current.lg = layouts.current.sm = layout;
          setResizing(false);
        }}
        onDragStart={() => {
          setDragging(true);
        }}
        onDragStop={(layout) => {
          layouts.current.lg = layouts.current.sm = layout;
          setDragging(false);
        }}
      >
        {["a", "b"].map((key) => (
          <div key={key} className="border rounded flex items-center justify-center">
            {key}
          </div>
        ))}
        <div key={"c"} className="border rounded flex items-center justify-center">
          <uiRegistry.Demo />
        </div>
        <div
          key="d"
          className={cn(
            theme === "dark" && "prose-invert",
            "prose max-w-[unset] border leading-[1.4]",
          )}
        >
          <div className="overflow-auto p-4 size-full">
            <TestMdx />
          </div>
        </div>
        <div key="e" className="border p-4 flex items-center justify-center">
          <button
            type="button"
            className="cursor-pointer border rounded px-4 py-1 bg-button"
            onPointerDown={themeApi.setOther}
          >
            {theme}
          </button>
        </div>
        <div key="f" className="overflow-hidden bg-black p-1 flex items-center justify-center">
          <Tty
            key="my-test-tty"
            sessionKey="tty-0"
            setTabsEnabled={() => {}}
            updateTabMeta={() => {}}
            disabled={false}
            env={{}}
            tabKey="my-tab-key"
            onKey={() => {}}
            modules={modules}
            shFiles={{}}
            profile={`import util\necho Hello, world\necho ...`}
          />
        </div>
      </GridLayout>
    </motion.div>
  );
}

type Props = {
  /** Initial layout configuration by breakpoint */
  layoutByBreakpoint: Partial<Record<"lg" | "sm", Layout>>;
  breakpoints: { lg: number; sm: number };
  colsByBreakpoint: { lg: number; sm: number };
};
