import { type UiRegistryKey, uiRegistry, uiRegistryKeys } from "@npc-cli/ui__registry";
import { cn, useStateRef, useUpdate } from "@npc-cli/util";
import { pause } from "@npc-cli/util/legacy/generic";
import { LockIcon } from "@phosphor-icons/react";
import type React from "react";
import { useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { GridLayout, type Layout, useContainerWidth, useResponsiveLayout } from "react-grid-layout";
import type { GridConfig } from "react-grid-layout/core";

import { layoutStore } from "./layout-store";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import useLongPress from "../hooks/use-long-press";

export function UiGrid({ uiLayout: initialUiLayout, ref }: Props) {
  const layouts = useRef(initialUiLayout.layouts);

  const { width, containerRef } = useContainerWidth({
    initialWidth: window.innerWidth, // avoid initial animation
  });

  const { layout, cols, setLayouts, breakpoint } = useResponsiveLayout({
    width,
    breakpoints: initialUiLayout.breakpoints,
    cols: initialUiLayout.cols,
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
        // margin: [10, 10],
      },
      isLocked: {},
      preventTransition: true,
      resizing: false,
      showContextMenu: false,
      toUi: { ...initialUiLayout.toUi },
      addItem({ itemId, uiKey, gridRect }) {
        state.toUi[itemId] = { uiKey };
        setLayouts({
          lg: layouts.current.lg.concat({
            i: itemId,
            x: gridRect.x,
            y: gridRect.y,
            w: gridRect.width,
            h: gridRect.height,
            isDraggable: true,
          }),
        });
      },
      closeContextMenu() {
        state.set({ showContextMenu: false });
      },
      onContextMenuItem(e) {
        if (!containerRef.current) return;

        const itemEl = e.currentTarget as HTMLElement;
        const containerRect = containerRef.current.getBoundingClientRect();
        const relativeX = e.clientX - containerRect.left;
        const relativeY = e.clientY - containerRect.top;
        const gridItemWidth = containerRef.current.clientWidth / cols;
        const gridItemHeight =
          (state.gridConfig.rowHeight || 150) + 2 * (state.gridConfig.margin?.[1] || 10);
        const gridX = Math.floor(relativeX / gridItemWidth);
        const gridY = Math.floor(relativeY / gridItemHeight);

        // 🚧 add item to layout at (gridX, gridY)
        const uiRegistryKey = itemEl.dataset.uiRegistryKey as UiRegistryKey;
        console.log({ uiRegistryKey, gridX, gridY });
        state.addItem({
          itemId: `ui-${crypto.randomUUID()}`,
          uiKey: uiRegistryKey,
          gridRect: { x: gridX, y: gridY, width: 2, height: 2 },
        });
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
          lg: layouts.current.lg.map((item) =>
            item.i === itemId ? { ...item, isDraggable: !locked } : item,
          ),
        });
      },
      set(partial: Partial<State>) {
        Object.assign(state, partial);
        update();
      },
    }),
    { deps: [breakpoint], reset: { gridConfig: true } },
  );
  const update = useUpdate();

  const longPressHandlers = useLongPress({
    // 🚧 clean
    // 🚧 overlay should ignore re-long-click
    onLongPress: ({ clientX, clientY }) => {
      containerRef.current?.style.setProperty(
        "--cm-transform",
        `translate(${clientX}px, ${clientY}px)`,
      );
      state.set({ showContextMenu: true });
    },
    ms: 500,
  });

  useEffect(state.onMount, [state.onMount]);

  useImperativeHandle<GridApi, GridApi>(
    ref,
    () => ({
      getUiLayout() {
        return {
          layouts: layouts.current,
          breakpoints: initialUiLayout.breakpoints,
          cols: initialUiLayout.cols,
          toUi: state.toUi,
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
      resetLayout() {
        state.toUi = { "ui-0": { uiKey: "Global" } };
        state.isLocked = {};
        layouts.current = { lg: [{ i: "ui-0", w: 2, h: 1, x: 0, y: 0 }] };
        setLayouts({
          sm: undefined,
          lg: { ...layouts.current.lg },
        });
      },
    }),
    [],
  );

  const childDefs = useMemo(
    () =>
      layout.map((item) => ({
        itemId: item.i,
        uiKey: state.toUi[item.i]?.uiKey,
        ui: uiRegistry[state.toUi[item.i]?.uiKey],
      })),
    [layout],
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: whatevs
    <div
      ref={containerRef}
      className="relative size-full overflow-auto"
      onContextMenu={state.onContextMenu}
      {...longPressHandlers}
    >
      <GridLayout
        className={cn(
          state.preventTransition && "[&_.react-grid-item]:transition-none!",
          (state.resizing || state.dragging) && "select-none",
          "h-full! text-on-background/60 [&_.react-resizable-handle::after]:border-on-background!",
          "[&_.react-resizable-handle::after]:z-200",
          "[&_.react-grid-placeholder]:bg-gray-500!",
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
          layouts.current.lg = layout;
        }}
      >
        {childDefs.map((def) => (
          <div
            key={def.itemId}
            data-item-id={def.itemId}
            className="relative border rounded *:rounded"
          >
            {def.ui ? <def.ui id={def.itemId} /> : <UnknownUi uiKey={def.uiKey} />}
            <div
              data-item-id={def.itemId}
              className={cn(
                "z-999 absolute bottom-1 left-1",
                "cursor-pointer p-0.5 bg-background text-on-background rounded-[50%]! hover:opacity-50",
                state.isLocked[def.itemId] ? "opacity-75!" : "opacity-25",
              )}
              onPointerUp={state.onToggleItemLock}
            >
              <LockIcon />
            </div>
          </div>
        ))}
      </GridLayout>

      <UiGridContextMenu state={state} />
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
  resetLayout(): void;
};

export type UiGridLayout = {
  breakpoints: Record<"lg" | "sm", number>;
  cols: Record<"lg" | "sm", number>;
  /** Only one layout but cols still responsive */
  layouts: Record<"lg", Layout>;
  toUi: { [layoutKey: string]: { uiKey: UiRegistryKey } };
};

type State = {
  dragging: boolean;
  gridConfig: Partial<GridConfig>;
  isLocked: { [layoutKey: string]: boolean };
  preventTransition: boolean;
  resizing: boolean;
  showContextMenu: boolean;
  toUi: UiGridLayout["toUi"];
  addItem(meta: {
    itemId: string;
    uiKey: UiRegistryKey;
    gridRect: { x: number; y: number; width: number; height: number };
  }): void;
  closeContextMenu(): void;
  onMount(): (() => void) | void;
  onResizeStart(): void;
  onResizeStop(): void;
  onContextMenuItem(e: React.MouseEvent<HTMLElement>): void;
  onContextMenu(e: MouseEvent | React.MouseEvent<HTMLElement>): void;
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

function UiGridContextMenu({ state }: { state: State }) {
  return (
    <div
      role="dialog"
      className={cn("fixed inset-0 bg-black/40", !state.showContextMenu && "hidden")}
      onClick={state.closeContextMenu}
      onKeyDown={undefined}
    >
      <div
        className={cn(
          "absolute top-0 left-0 transform-(--cm-transform)",
          "flex flex-col gap-0.5",
          "border bg-black border-white/20 p-1 rounded-md text-white",
          !state.showContextMenu && "hidden",
        )}
      >
        {uiRegistryKeys.map((uiRegistryKey) => (
          <button
            type="button"
            key={uiRegistryKey}
            data-ui-registry-key={uiRegistryKey}
            className="px-2 py-1 hover:bg-white/20 cursor-pointer lowercase text-sm text-left tracking-widest"
            onClick={state.onContextMenuItem}
          >
            {uiRegistryKey}
          </button>
        ))}
      </div>
    </div>
  );
}
