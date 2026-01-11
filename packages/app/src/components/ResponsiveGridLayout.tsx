import { type UiRegistryKey, uiRegistry } from "@npc-cli/ui__registry";
import { cn } from "@npc-cli/util";
import React, { useEffect, useRef, useState } from "react";
import { GridLayout, type Layout, useContainerWidth, useResponsiveLayout } from "react-grid-layout";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

export function ResponsiveGridLayout({
  uiLayout: { breakpoints, cols: colsByBreakpoint, layouts: layoutByBreakpoint, layoutToUi },
}: Props) {
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

  useEffect(() => void setTimeout(() => setPreventTransition(false), 1), []);

  return (
    <div ref={containerRef} className="w-full overflow-auto h-full border border-white">
      <GridLayout
        className={cn(
          preventTransition && "[&_.react-grid-item]:transition-none!",
          (resizing || dragging) && "select-none",
          "text-on-background/60 [&_.react-resizable-handle::after]:border-on-background!",
        )}
        width={width}
        gridConfig={{
          cols,
          rowHeight: 80,
          // margin: [0, 0],
        }}
        layout={layout}
        onResizeStart={() => {
          setResizing(true);
        }}
        onResizeStop={(layout) => {
          layouts.current[breakpoint] = layout;
          setResizing(false);
        }}
        onDragStart={() => {
          setDragging(true);
        }}
        onDragStop={(layout) => {
          layouts.current[breakpoint] = layout;
          setDragging(false);
        }}
      >
        {layout.map((item) => (
          <div key={item.i} className="border rounded">
            {React.createElement(uiRegistry[layoutToUi[item.i].uiKey])}
          </div>
        ))}
      </GridLayout>
    </div>
  );
}

type Props = {
  uiLayout: UiLayout;
};

export type UiLayout = {
  breakpoints: Record<"lg" | "sm", number>;
  cols: Record<"lg" | "sm", number>;
  layouts: Record<"lg" | "sm", Layout>;
  layoutToUi: { [layoutKey: string]: { uiKey: UiRegistryKey } };
};
