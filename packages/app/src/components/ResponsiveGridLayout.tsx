import { GridLayout, type Layout, useContainerWidth, useResponsiveLayout } from "react-grid-layout";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

import { useThemeName } from "@npc-cli/theme";
import { uiRegistry } from "@npc-cli/ui__registry";
import { cn } from "@npc-cli/util";
import { useEffect, useRef, useState } from "react";

export function ResponsiveGridLayout({ layoutByBreakpoint, breakpoints, colsByBreakpoint }: Props) {
  const layouts = useRef(layoutByBreakpoint);

  const { width, containerRef } = useContainerWidth({
    initialWidth: window.innerWidth, // avoid initial animation + positionStrategy={absoluteStrategy}
  });

  const { layout, cols, setLayouts, breakpoint } = useResponsiveLayout({
    width,
    breakpoints,
    cols: colsByBreakpoint,
    layouts: layouts.current,
    onBreakpointChange(_bp, _cols) {
      // Fixes overflow on slow/sudden change
      setLayouts((layouts.current = { ...layouts.current }));
    },
  });

  // 🚧 useStateRef and useUpdate
  const [preventTransition, setPreventTransition] = useState(true);
  const [resizing, setResizing] = useState(false);
  const [dragging, setDragging] = useState(false);

  // 🚧 packages/ui/themer
  const theme = useThemeName();

  useEffect(() => void setTimeout(() => setPreventTransition(false), 0), []);

  return (
    <div ref={containerRef} className="w-full overflow-auto h-full border border-white">
      <GridLayout
        className={cn(
          preventTransition && "[&_.react-grid-item]:transition-none!",
          (resizing || dragging) && "select-none",
          "text-on-background/60 [&_.react-resizable-handle::after]:border-on-background!",
        )}
        // autoSize={false}
        // compactor={noCompactor}
        width={width}
        // dragConfig={{}}
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
          // layouts.current.lg = layouts.current.sm = layout;
          layouts.current[breakpoint] = layout;
          setResizing(false);
        }}
        onDragStart={() => {
          setDragging(true);
        }}
        onDragStop={(layout) => {
          // layouts.current.lg = layouts.current.sm = layout;
          layouts.current[breakpoint] = layout;
          setDragging(false);
        }}
        // positionStrategy={absoluteStrategy}
      >
        {["a", "b"].map((key) => (
          <div key={key} className="border rounded flex items-center justify-center">
            <uiRegistry.Template />
          </div>
        ))}
        <div key={"c"} className="border rounded flex items-center justify-center">
          <uiRegistry.Template />
        </div>
        <div key="d">
          <uiRegistry.Blog />
        </div>
        <div key="e">
          <uiRegistry.Global />
        </div>
        <div key="f">
          <uiRegistry.Jsh />
        </div>
      </GridLayout>
    </div>
  );
}

type Props = {
  /** Initial layout configuration by breakpoint */
  layoutByBreakpoint: Partial<Record<"lg" | "sm", Layout>>;
  breakpoints: { lg: number; sm: number };
  colsByBreakpoint: { lg: number; sm: number };
};
