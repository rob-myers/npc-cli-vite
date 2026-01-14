import { type UiRegistryKey, uiRegistry, uiRegistryKeys } from "@npc-cli/ui__registry";
import { cn, useStateRef, useUpdate } from "@npc-cli/util";
import { pause } from "@npc-cli/util/legacy/generic";
import { LockIcon } from "@phosphor-icons/react";
import React, { useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { GridLayout, type Layout, useContainerWidth, useResponsiveLayout } from "react-grid-layout";
import type { GridConfig } from "react-grid-layout/core";

import { layoutStore } from "./layout-store";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

export function UiGrid({
  uiLayout: { breakpoints, cols: colsByBreakpoint, layouts: layoutByBreakpoint, toUi },
  ref,
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
      dragging: false,
      gridConfig: {
        cols,
        rowHeight: 80,
        // margin: [0, 0],
      },
      isLocked: {},
      preventTransition: true,
      resizing: false,
      showContextMenu: false,
      closeContextMenu() {
        state.set({ showContextMenu: false });
      },
      onContextMenu(e) {
        if (
          (e.target as HTMLElement).parentElement !== containerRef.current ||
          !containerRef.current
        ) {
          return;
        }
        e.preventDefault();

        containerRef.current.style.setProperty(
          "--cm-transform",
          `translate(${e.clientX}px, ${e.clientY}px)`,
        );

        state.set({ showContextMenu: true });
      },
      onDragStart() {
        state.set({ dragging: true });
      },
      onDragStop() {
        state.set({ dragging: false });
      },
      onMount() {
        pause(1).then(() => {
          state.set({ preventTransition: false });
          layoutStore.setState({ ready: true });
        });
        const onKeyUp = (e: KeyboardEvent) => {
          if (e.key === "Escape" && state.showContextMenu) state.set({ showContextMenu: false });
        };
        document.body.addEventListener("keyup", onKeyUp);
        return () => document.body.removeEventListener("keyup", onKeyUp);
      },
      onResizeStart() {
        state.set({ resizing: true });
      },
      onResizeStop() {
        state.set({ resizing: false });
      },
      onToggleItemLock(e: React.PointerEvent<HTMLDivElement>) {
        const itemId = e.currentTarget.dataset.itemId as string;
        const locked = (state.isLocked[itemId] = !state.isLocked[itemId]);

        setLayouts({
          [breakpoint]: layouts.current[breakpoint].map((item) =>
            item.i === itemId ? { ...item, isDraggable: !locked } : item,
          ),
        });
      },
      set(partial: Partial<State>) {
        Object.assign(state, partial);
        update();
      },
    }),
    { deps: [breakpoint] },
  );
  const update = useUpdate();

  useEffect(state.onMount, [state.onMount]);

  useImperativeHandle<GridApi, GridApi>(
    ref,
    () => ({
      getUiLayout() {
        return {
          layouts: layouts.current,
          breakpoints,
          cols: colsByBreakpoint,
          toUi,
        };
      },
      getItemToRect() {
        return Object.fromEntries(
          Array.from(document.querySelectorAll<HTMLElement>(".react-grid-item")).map((el) => [
            el.dataset.itemId,
            el.getBoundingClientRect(),
          ]),
        );
      },
    }),
    [],
  );

  const childDefs = useMemo(
    () =>
      layout.map((item) => ({
        itemId: item.i,
        uiKey: toUi[item.i]?.uiKey,
        ui: uiRegistry[toUi[item.i]?.uiKey],
      })),
    [layout, toUi],
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: whatevs
    <div
      ref={containerRef}
      className="relative size-full overflow-auto"
      onContextMenu={state.onContextMenu}
    >
      <GridLayout
        className={cn(
          state.preventTransition && "[&_.react-grid-item]:transition-none!",
          (state.resizing || state.dragging) && "select-none",
          "text-on-background/60 [&_.react-resizable-handle::after]:border-on-background!",
          "[&_.react-resizable-handle::after]:z-200",
        )}
        width={width}
        gridConfig={state.gridConfig}
        layout={layout}
        onResizeStart={state.onResizeStart}
        onResizeStop={state.onResizeStop}
        onDragStart={state.onDragStart}
        onDragStop={state.onDragStop}
        onLayoutChange={(layout) => {
          // console.log("onLayoutChange", layout);
          layouts.current[breakpoint] = layout;
        }}
      >
        {childDefs.map((def) => (
          <div
            key={def.itemId}
            data-item-id={def.itemId}
            className="relative border rounded *:rounded"
          >
            {def.ui ? React.createElement(def.ui) : <UnknownUi uiKey={def.uiKey} />}
            <div
              data-item-id={def.itemId}
              className={cn(
                "z-999 absolute bottom-1 left-1 cursor-pointer p-0.5",
                state.isLocked[def.itemId] ? "opacity-100" : "opacity-50",
              )}
              onPointerUp={state.onToggleItemLock}
            >
              <LockIcon />
            </div>
          </div>
        ))}
      </GridLayout>

      <UiGridContextMenu uiGridApi={state} />
    </div>
  );
}

type Props = {
  uiLayout: UiGridLayout;
  ref: React.Ref<GridApi>;
};

export type GridApi = {
  getUiLayout(): UiGridLayout;
  getItemToRect(): { [itemId: string]: { x: number; y: number; width: number; height: number } };
};

export type UiGridLayout = {
  breakpoints: Record<"lg" | "sm", number>;
  cols: Record<"lg" | "sm", number>;
  layouts: Record<"lg" | "sm", Layout>;
  toUi: { [layoutKey: string]: { uiKey: UiRegistryKey } };
};

type State = {
  dragging: boolean;
  gridConfig: Partial<GridConfig>;
  isLocked: { [layoutKey: string]: boolean };
  preventTransition: boolean;
  resizing: boolean;
  showContextMenu: boolean;
  closeContextMenu(): void;
  onMount(): (() => void) | void;
  onResizeStart(): void;
  onResizeStop(): void;
  onContextMenu(e: React.MouseEvent<HTMLElement>): void;
  onDragStart(): void;
  onDragStop(): void;
  onToggleItemLock(e: React.PointerEvent<HTMLDivElement>): void;
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

function UiGridContextMenu({ uiGridApi }: { uiGridApi: State }) {
  return (
    <div
      role="dialog"
      className={cn("fixed inset-0 bg-black/40", !uiGridApi.showContextMenu && "hidden")}
      onClick={uiGridApi.closeContextMenu}
      onKeyDown={undefined}
    >
      <div
        className={cn(
          "absolute top-0 left-0 transform-(--cm-transform)",
          "flex flex-col",
          "bg-on-background text-background",
          !uiGridApi.showContextMenu && "hidden",
        )}
      >
        {uiRegistryKeys.map((uiRegistryKey) => (
          <button
            type="button"
            key={uiRegistryKey}
            className="px-2 py-1 hover:bg-background/20 cursor-pointer font-mono text-left border-b border-black/30 tracking-wide"
          >
            {uiRegistryKey}
          </button>
        ))}
      </div>
    </div>
  );
}
