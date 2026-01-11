import { type UiRegistryKey, uiRegistry } from "@npc-cli/ui__registry";
import { cn, useStateRef, useUpdate } from "@npc-cli/util";
import { pause } from "@npc-cli/util/legacy/generic";
import React, { useEffect, useRef } from "react";
import { GridLayout, type Layout, useContainerWidth, useResponsiveLayout } from "react-grid-layout";
import type { GridConfig } from "react-grid-layout/core";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

export function ResponsiveGridLayout({
  uiLayout: { breakpoints, cols: colsByBreakpoint, layouts: layoutByBreakpoint, layoutToUi },
}: Props) {
  const layouts = useRef(layoutByBreakpoint);

  const { width, containerRef } = useContainerWidth({
    initialWidth: window.innerWidth, // avoid initial animation
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

  const state = useStateRef(
    (): State => ({
      preventTransition: true,
      resizing: false,
      dragging: false,
      gridConfig: {
        cols,
        rowHeight: 80,
        // margin: [0, 0],
      },
      onMount() {
        pause(1).then(() => state.set({ preventTransition: false }));
      },
      onResizeStart() {
        state.set({ resizing: true });
      },
      onResizeStop() {
        layouts.current[breakpoint] = layout;
        state.set({ resizing: false });
      },
      onDragStart() {
        state.set({ dragging: true });
      },
      onDragStop() {
        layouts.current[breakpoint] = layout;
        state.set({ dragging: false });
      },
      set(partial: Partial<State>) {
        Object.assign(state, partial);
        update();
      },
    }),
  );
  const update = useUpdate();

  useEffect(state.onMount, []);

  return (
    <div ref={containerRef} className="w-full overflow-auto h-full border border-white">
      <GridLayout
        className={cn(
          state.preventTransition && "[&_.react-grid-item]:transition-none!",
          (state.resizing || state.dragging) && "select-none",
          "text-on-background/60 [&_.react-resizable-handle::after]:border-on-background!",
        )}
        width={width}
        gridConfig={state.gridConfig}
        layout={layout}
        onResizeStart={state.onResizeStart}
        onResizeStop={state.onResizeStop}
        onDragStart={state.onDragStart}
        onDragStop={state.onDragStop}
      >
        {layout.map((item) => (
          <div key={item.i} className="border rounded *:rounded">
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

type State = {
  preventTransition: boolean;
  resizing: boolean;
  dragging: boolean;
  gridConfig: Partial<GridConfig>;
  onMount(): void;
  onResizeStart(): void;
  onResizeStop(): void;
  onDragStart(): void;
  onDragStop(): void;
  set(partial: Partial<State>): void;
};
