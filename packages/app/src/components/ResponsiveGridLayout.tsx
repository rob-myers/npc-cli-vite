import { type UiRegistryKey, uiRegistry } from "@npc-cli/ui__registry";
import { cn, useStateRef, useUpdate } from "@npc-cli/util";
import { pause } from "@npc-cli/util/legacy/generic";
import React, { useEffect, useRef } from "react";
import { GridLayout, type Layout, useContainerWidth, useResponsiveLayout } from "react-grid-layout";
import type { GridConfig } from "react-grid-layout/core";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

export function ResponsiveGridLayout({
  uiLayout: { breakpoints, cols: colsByBreakpoint, layouts: layoutByBreakpoint, toUi },
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

  const childDefs = layout.map((item) => ({
    layoutId: item.i,
    uiKey: toUi[item.i]?.uiKey,
    ui: uiRegistry[toUi[item.i]?.uiKey],
  }));

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
        {childDefs.map((def) => (
          <div key={def.layoutId} className="border rounded *:rounded">
            {def.ui ? React.createElement(def.ui) : <UnknownUi uiKey={def.uiKey} />}
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
  toUi: { [layoutKey: string]: { uiKey: UiRegistryKey } };
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

function UnknownUi({ uiKey }: { uiKey: string }) {
  return (
    <div className="size-full flex items-center justify-center bg-red-300 text-black">
      <div className="flex gap-1 bg-white rounded-2xl px-4">
        Unknown UI -<div className="text-red-500">{uiKey ?? "(no ui key)"}</div>
      </div>
    </div>
  );
}
