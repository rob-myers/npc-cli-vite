import { ContextMenu } from "@base-ui/react/context-menu";
import { Popover } from "@base-ui/react/popover";
import { type UiRegistryKey, uiRegistry, uiRegistryKeys } from "@npc-cli/ui-registry";
import type {
  AddUiItemOpts,
  OverrideContextMenuOpts,
  UiBootstrapProps,
  UiContextValue,
  UiInstanceMeta,
} from "@npc-cli/ui-sdk";
import { UiInstanceMenu } from "@npc-cli/ui-sdk/UiInstanceMenu";
import { uiStore, uiStoreApi } from "@npc-cli/ui-sdk/ui.store";
import {
  allowReactGridDragClassName,
  cn,
  PopoverArrow,
  preventReactGridDragClassName,
  Spinner,
  useStateRef,
} from "@npc-cli/util";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { mapValues, pause } from "@npc-cli/util/legacy/generic";
import type React from "react";
import { Suspense, useEffect, useMemo, useRef } from "react";
import { useBeforeunload } from "react-beforeunload";
import {
  cloneLayoutItem,
  collides,
  GridLayout,
  type Layout,
  useContainerWidth,
  useResponsiveLayout,
  verticalCompactor,
} from "react-grid-layout";
import type { Compactor, GridConfig, LayoutItem, ResizeConfig } from "react-grid-layout/core";
import * as portals from "react-reverse-portal";
import { useStore } from "zustand";
import { UiGridMenu } from "./UiGridMenu";

import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const USE_SWAP_COMPACTOR = true;

export function UiGrid({ extendContextValue, persistedLayout }: Props) {
  const layouts = useRef(persistedLayout.layouts);
  const fitItemRef = useRef<((id: string) => void) | null>(null);

  const dragSwapRef = useRef<{
    isDragging: boolean;
    draggedId: string | null;
    preLayout: Layout | null;
  }>({ isDragging: false, draggedId: null, preLayout: null });

  const swapCompactor = useMemo(
    (): Compactor => ({
      type: "vertical",
      allowOverlap: true,
      compact(layout, cols) {
        const { isDragging, draggedId, preLayout } = dragSwapRef.current;
        if (!isDragging || !draggedId || !preLayout) {
          return verticalCompactor.compact(layout, cols);
        }
        const dragged = layout.find((item) => item.i === draggedId);
        if (!dragged) return verticalCompactor.compact(layout, cols);

        const draggedPre = preLayout.find((item) => item.i === draggedId);
        if (!draggedPre) return verticalCompactor.compact(layout, cols);

        // Check overlaps against pre-drag positions (not current), so the
        // result is deterministic for a given mouse position — no flip-flop
        const overlapping = preLayout.filter((pre) => pre.i !== draggedId && collides(dragged, pre));

        if (overlapping.length > 0) {
          const candidates = preLayout.map((pre) => {
            if (pre.i === draggedId) return dragged;
            if (overlapping.some((o) => o.i === pre.i)) return { ...pre, x: draggedPre.x, y: draggedPre.y };
            return pre;
          });

          const isDisjoint = candidates.every((a, i) => candidates.every((b, j) => i >= j || !collides(a, b)));

          if (isDisjoint) {
            return layout.map((item) => {
              if (item.i === draggedId) return cloneLayoutItem(item);
              const c = candidates.find((c) => c.i === item.i);
              return cloneLayoutItem(c ? { ...item, x: c.x, y: c.y } : item);
            });
          }
        }

        // No swap — fall back to vertical compaction
        return verticalCompactor.compact(layout, cols);
      },
    }),
    [],
  );

  const { width, containerRef } = useContainerWidth({
    initialWidth: window.innerWidth, // avoid initial animation
  });

  const { layout, cols, setLayouts } = useResponsiveLayout({
    width,
    breakpoints: persistedLayout.breakpoints,
    cols: persistedLayout.cols,
    layouts: layouts.current,
    onBreakpointChange(_bp, newCols) {
      const oldCols = state.gridConfig.cols ?? newCols;
      if (oldCols !== newCols) {
        const scaled = layouts.current.lg.map((item) => ({
          ...item,
          x: Math.round((item.x / oldCols) * newCols),
          w: Math.max(1, Math.round((item.w / oldCols) * newCols)),
        }));
        layouts.current = { lg: scaled };
      }
      setLayouts((layouts.current = { ...layouts.current }));
    },
  });

  const state = useStateRef(
    (): State => ({
      contextMenuOpen: false,
      contextMenuPopoverHandle: Popover.createHandle(),
      contextMenuPopoverUi: null,
      dragging: false,
      gridConfig: {
        cols,
        rowHeight: 30,
        margin: [8, 8],
        containerPadding: [0, 0],
      },
      resizeMode: false,
      numTouches: 0,
      overrideContextMenuOpts: null,
      preventTransition: true,
      resizeConfig: {
        resizeMode: { handles: ["n", "ne", "e", "se", "s", "sw", "w", "nw"] },
        default: { handles: isTouchDevice() ? [] : ["se"] },
      },
      resizing: false,
      visualViewportRect: null,

      addItem({ uiMeta, gridRect }) {
        if (state.overrideContextMenuOpts?.addItem) {
          state.overrideContextMenuOpts.addItem({ uiMeta });
        } else {
          uiStoreApi.addUis({ metas: [uiMeta] });

          layouts.current.lg = layouts.current.lg.concat({
            i: uiMeta.id,
            x: gridRect.x,
            y: gridRect.y,
            w: gridRect.width,
            h: gridRect.height,
            isDraggable: true,
          });
          setLayouts({ lg: layouts.current.lg });
        }
      },
      closeContextMenu() {
        state.set({
          contextMenuPopoverUi: null,
          contextMenuOpen: false,
        });
        state.contextMenuPopoverHandle.close();
      },
      isGridContainer(el) {
        return el === containerRef.current?.childNodes[0];
      },
      onChangeContextMenu(open, eventDetails) {
        if (!open) {
          state.set({ overrideContextMenuOpts: undefined });
          state.contextMenuPopoverHandle.close();
        } else if (!state.isGridContainer(eventDetails.event.target as HTMLElement)) {
          return; // ignore long press on grid children
        }
        if (state.numTouches > 1) {
          return; // try avoid pinch zoom
        }

        state.set({ contextMenuOpen: open });
      },
      onClickItemLock(e) {
        e.stopPropagation();
        const itemId = e.currentTarget.dataset.itemId as string;
        setLayouts({
          lg: layouts.current.lg.map((item) =>
            item.i === itemId
              ? {
                  ...item,
                  isDraggable: true,
                }
              : item,
          ),
        });
      },
      async onContextMenuItem(e) {
        // invoked from ContextMenu.Item or Popover.Trigger
        const cmDiv = e.currentTarget.closest("[data-context-menu-div]");
        const uiDiv = e.currentTarget.closest("[data-ui-registry-key]");

        if (!containerRef.current || !cmDiv || !uiDiv) return;

        const uiRegistryKey = (uiDiv as HTMLElement).dataset.uiRegistryKey as UiRegistryKey;
        const { x: clientX, y: clientY } = cmDiv.getBoundingClientRect();

        const containerRect = containerRef.current.getBoundingClientRect();
        const relativeX = clientX - containerRect.left;
        const relativeY = clientY - containerRect.top;
        const gridItemWidth = containerRef.current.clientWidth / cols;
        const gridItemHeight = (state.gridConfig.rowHeight || 150) + 2 * (state.gridConfig.margin?.[1] || 10);
        const gridX = Math.floor(relativeX / gridItemWidth);
        const gridY = Math.floor(relativeY / gridItemHeight);

        const def = uiRegistry[uiRegistryKey];

        if (def.bootstrap) {
          // further details needed for instantiation
          state.set({
            contextMenuPopoverUi: {
              uiKey: uiRegistryKey,
              ui: def.bootstrap,
              point: { x: gridX, y: gridY },
            },
          });
        } else {
          // add item directly from context menu without params
          const itemId = `ui-${crypto.randomUUID()}`;
          state.addItem({
            uiMeta: {
              id: itemId,
              title: uiStoreApi.getDefaultTitle(uiRegistryKey),
              uiKey: uiRegistryKey,
            },
            gridRect: { x: gridX, y: gridY, width: 2, height: 4 },
          });
          requestAnimationFrame(() => fitItemRef.current?.(itemId));
        }
      },
      onDragStart() {
        state.set({ dragging: true });
      },
      onDragStop() {
        state.set({ dragging: false });
      },
      onResizeStart() {
        state.set({ resizing: true });
      },
      onResizeStop() {
        state.set({ resizing: false });
      },
      persist() {
        uiStore.setState({
          persistedLayout: {
            layouts: layouts.current,
            breakpoints: persistedLayout.breakpoints,
            cols: persistedLayout.cols,
            toUi: mapValues(uiStore.getState().byId, ({ meta }) => meta),
          },
          persistedItemToRect: Object.fromEntries(
            Array.from(document.querySelectorAll<HTMLElement>(".react-grid-item")).map((el) => [
              el.dataset.itemId,
              el.getBoundingClientRect(),
            ]),
          ),
        });
      },
      updateNumTouches(e) {
        state.numTouches = e.touches.length;
      },
    }),
    { deps: [layout], reset: { gridConfig: true } },
  );

  useEffect(() => {
    pause(1).then(() => {
      state.set({ preventTransition: false });
      uiStore.setState({ ready: true });
    });

    // Mobile: fix hidden ContextMenu on mobile keyboard
    function onChangeVisualViewport() {
      window.visualViewport !== null &&
        state.set({
          visualViewportRect: {
            x: 0,
            y: 0,
            width: window.visualViewport.width,
            height: window.visualViewport.height,
          },
        });
    }
    window.addEventListener("resize", onChangeVisualViewport);
    return () => window.removeEventListener("resize", onChangeVisualViewport);
  }, []);

  useEffect(() => {
    const api: UiContextValue["layoutApi"] = {
      appendLayoutItems: (ls: Layout) => {
        layouts.current.lg = layouts.current.lg.concat(ls);
        setLayouts({ lg: layouts.current.lg });
      },
      getCols() {
        return state.gridConfig.cols ?? cols;
      },
      getViewportRows() {
        const el = containerRef.current;
        const top = el?.getBoundingClientRect().top ?? 0;
        const availableHeight = window.innerHeight - top;
        const rowH = state.gridConfig.rowHeight || 30;
        const marginY = state.gridConfig.margin?.[1] || 8;
        const padY = state.gridConfig.containerPadding?.[1] || 0;
        return Math.max(1, Math.floor((availableHeight - 2 * padY + marginY) / (rowH + marginY)));
      },
      fitItem(id) {
        const currentCols = state.gridConfig.cols ?? cols;
        const el = containerRef.current;
        const top = el?.getBoundingClientRect().top ?? 0;
        const availableHeight = window.innerHeight - top;
        const rowH = state.gridConfig.rowHeight || 30;
        const marginY = state.gridConfig.margin?.[1] || 8;
        const padY = state.gridConfig.containerPadding?.[1] || 0;
        const viewportRows = Math.max(1, Math.floor((availableHeight - 2 * padY + marginY) / (rowH + marginY)));

        const target = layouts.current.lg.find((item) => item.i === id);
        if (!target) return;

        const others = layouts.current.lg.filter((item) => item.i !== id);
        const contentRows = others.reduce((max, item) => Math.max(max, item.y + item.h), 0);
        const rows = Math.max(viewportRows, contentRows);

        const occupied = Array.from({ length: rows }, () => new Uint8Array(currentCols));
        for (const o of others) {
          for (let r = o.y; r < Math.min(o.y + o.h, rows); r++)
            for (let c = o.x; c < Math.min(o.x + o.w, currentCols); c++) occupied[r][c] = 1;
        }

        // biome-ignore format: succinct
        const expand = (widthFirst: boolean) => {
            let x1 = Math.max(0, target.x),
              y1 = Math.max(0, target.y);
            let x2 = Math.min(currentCols, target.x + target.w),
              y2 = Math.min(rows, target.y + target.h);
            let changed = true;
            while (changed) {
              changed = false;
              if (widthFirst) {
                if (x1 > 0 && colFree(occupied, x1 - 1, y1, y2)) { x1--; changed = true; }
                if (x2 < currentCols && colFree(occupied, x2, y1, y2)) { x2++; changed = true; }
                if (y1 > 0 && rowFree(occupied, y1 - 1, x1, x2)) { y1--; changed = true; }
                if (y2 < rows && rowFree(occupied, y2, x1, x2)) { y2++; changed = true; }
              } else {
                if (y1 > 0 && rowFree(occupied, y1 - 1, x1, x2)) { y1--; changed = true; }
                if (y2 < rows && rowFree(occupied, y2, x1, x2)) { y2++; changed = true; }
                if (x1 > 0 && colFree(occupied, x1 - 1, y1, y2)) { x1--; changed = true; }
                if (x2 < currentCols && colFree(occupied, x2, y1, y2)) { x2++; changed = true; }
              }
            }
            return { x1, y1, w: x2 - x1, h: y2 - y1 };
          };
        const wFirst = expand(true);
        const hFirst = expand(false);
        const best = wFirst.w * wFirst.h >= hFirst.w * hFirst.h ? wFirst : hFirst;

        const newLg = layouts.current.lg.map((item) =>
          item.i === id ? { ...item, x: best.x1, y: best.y1, w: best.w, h: best.h } : item,
        );
        layouts.current.lg = newLg;
        setLayouts({ lg: newLg });
      },
      halveItem(id, direction) {
        const newLg = layouts.current.lg.map((item) =>
          item.i === id
            ? {
                ...item,
                ...(direction === "horizontal"
                  ? { w: Math.max(1, Math.ceil(item.w / 2)) }
                  : { h: Math.max(1, Math.ceil(item.h / 2)) }),
              }
            : item,
        );
        layouts.current.lg = newLg;
        setLayouts({ lg: newLg });
      },
      getUiGridRect: (id) => {
        const found = layouts.current.lg.find((item) => item.i === id);
        return found ? { x: found.x, y: found.y, w: found.w, h: found.h } : null;
      },
      removeLayoutItem(id) {
        layouts.current.lg = layouts.current.lg.filter((item) => item.i !== id);
        setLayouts({ lg: layouts.current.lg });
      },
      overrideContextMenu({ refObject, addItem }) {
        state.set({
          contextMenuOpen: true,
          overrideContextMenuOpts: { refObject, addItem },
        });
      },
      screenToGrid(clientX, clientY) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return null;
        const gridItemWidth = rect.width / (state.gridConfig.cols ?? cols);
        const gridItemHeight = (state.gridConfig.rowHeight || 150) + 2 * (state.gridConfig.margin?.[1] || 10);
        return {
          x: Math.floor((clientX - rect.left) / gridItemWidth),
          y: Math.floor((clientY - rect.top) / gridItemHeight),
        };
      },
    };
    fitItemRef.current = api.fitItem;
    return extendContextValue(api);
  }, [setLayouts]);

  const byId = useStore(uiStore, (s) => s.byId);
  const topLevelUis = useMemo(() => Object.values(byId).filter(({ meta }) => !meta.parentId), [byId]);

  useBeforeunload(() => {
    state.persist();
  });

  return (
    <>
      <ContextMenu.Root open={state.contextMenuOpen} onOpenChange={state.onChangeContextMenu}>
        <ContextMenu.Trigger className="size-full">
          <div
            ref={containerRef}
            className="relative size-full overflow-auto"
            onContextMenu={(e) => {
              state.set({ overrideContextMenuOpts: null });
              if (!state.isGridContainer(e.target as HTMLElement)) {
                e.stopPropagation(); // show native context menu on right click children
              }
            }}
            // avoid pinch zoom triggering context menu
            onTouchStart={state.updateNumTouches}
            onTouchEnd={state.updateNumTouches}
            onTouchCancel={state.updateNumTouches}
          >
            <GridLayout
              className={cn(
                state.preventTransition && "[&_.react-grid-item]:transition-none!",
                (state.resizing || state.dragging || state.contextMenuOpen) && "select-none",
                "min-h-full! text-on-background/60",
                "[&_.react-resizable-handle::after]:border-on-background!",
                "[&_.react-resizable-handle::after]:z-1",
                // "[&_.react-resizable-handle::after]:size-4!",
                "[&_.react-grid-placeholder]:bg-gray-500!",
              )}
              width={width}
              dragConfig={{
                cancel: `.${preventReactGridDragClassName}`,
                handle: `.${allowReactGridDragClassName}`,
                // threshold: 10, // Touch doesn't work
              }}
              gridConfig={state.gridConfig}
              resizeConfig={state.resizeMode ? state.resizeConfig.resizeMode : state.resizeConfig.default}
              compactor={USE_SWAP_COMPACTOR ? swapCompactor : undefined}
              layout={layout}
              onResizeStart={state.onResizeStart}
              onResizeStop={state.onResizeStop}
              onDragStart={(layout: Layout, oldItem: LayoutItem | null) => {
                state.onDragStart();
                if (USE_SWAP_COMPACTOR && oldItem) {
                  dragSwapRef.current = {
                    isDragging: true,
                    draggedId: oldItem.i,
                    preLayout: layout.map((l) => ({ ...l })),
                  };
                }
              }}
              onDragStop={() => {
                state.onDragStop();
                if (USE_SWAP_COMPACTOR) {
                  dragSwapRef.current = { isDragging: false, draggedId: null, preLayout: null };
                }
              }}
              onLayoutChange={(layout) => {
                layouts.current.lg = layout;
                setLayouts({ lg: layout }); // sync hook state with rendered layout
              }}
            >
              {topLevelUis.map(({ meta, portal }) => {
                return (
                  <div
                    key={meta.id}
                    data-item-id={meta.id} // used by getItemToRect
                    className={cn(
                      "relative border border-on-background/20",
                      "*:first:transition-all",
                      ...(state.resizeMode
                        ? [
                            allowReactGridDragClassName,
                            "cursor-move *:first:p-5 *:first:pointer-events-none *:first:grayscale *:first:contrast-70 border-blue-500/60",
                          ]
                        : []),
                    )}
                  >
                    <portals.OutPortal node={portal.portalNode} />
                    {!meta.customUiInstanceMenu && (
                      <UiInstanceMenu
                        className={cn("z-999 absolute top-1", meta.menuPosition === "left" ? "left-1" : "right-1")}
                        meta={meta}
                      />
                    )}
                    <DraggableOverlay />
                  </div>
                );
              })}
            </GridLayout>

            <UiGridMenu state={state} />
          </div>
        </ContextMenu.Trigger>

        <ContextMenu.Portal>
          <ContextMenu.Positioner
            anchor={state.overrideContextMenuOpts?.refObject ?? undefined}
            collisionBoundary={state.visualViewportRect ?? undefined}
          >
            <ContextMenu.Popup
              className="flex flex-col rounded-md bg-black/80 text-white outline-black"
              data-context-menu-div
            >
              {uiRegistryKeys.map((uiRegistryKey) => (
                <ContextMenu.Item
                  key={uiRegistryKey}
                  data-ui-registry-key={uiRegistryKey}
                  className="hover:bg-white/20 first:rounded-t-md last:rounded-b-md not-last:border-b border-white/20 outline-black text-left tracking-widest"
                  closeOnClick={!uiRegistry[uiRegistryKey].bootstrap}
                  onClick={state.onContextMenuItem}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " " || e.key === "ArrowLeft" || e.key === "ArrowRight") {
                      e.stopPropagation();
                      if (uiRegistry[uiRegistryKey].bootstrap) {
                        state.contextMenuPopoverHandle.open(e.currentTarget.children[0].id);
                        state.onContextMenuItem(e);
                      }
                    }
                  }}
                >
                  {uiRegistry[uiRegistryKey].bootstrap ? (
                    <Popover.Trigger
                      className="w-full px-4 py-1.5 text-left cursor-pointer"
                      handle={state.contextMenuPopoverHandle}
                      tabIndex={-1}
                    >
                      {uiRegistryKey}
                    </Popover.Trigger>
                  ) : (
                    <div className="w-full px-4 py-1.5 text-left cursor-pointer">{uiRegistryKey}</div>
                  )}
                </ContextMenu.Item>
              ))}
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <Popover.Root handle={state.contextMenuPopoverHandle}>
        <Popover.Portal>
          <Popover.Positioner side={isTouchDevice() ? "top" : "right"} sideOffset={8}>
            <Popover.Popup initialFocus={false}>
              <PopoverArrow arrowBorderFill="#ffffff" />
              <Popover.Description render={(props) => <div className="bg-black text-white" {...props} />}>
                {state.contextMenuPopoverUi && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <Suspense fallback={<Spinner />}>
                      <state.contextMenuPopoverUi.ui
                        addInstance={(partialUiMeta) => {
                          if (!state.contextMenuPopoverUi) return;

                          // add item from context menu with extra config from bootstrap component
                          const itemId = `ui-${crypto.randomUUID()}`;
                          state.addItem({
                            uiMeta: {
                              title: uiStoreApi.getDefaultTitle(state.contextMenuPopoverUi.uiKey),
                              ...partialUiMeta,
                              id: itemId,
                              uiKey: state.contextMenuPopoverUi.uiKey,
                            },
                            gridRect: {
                              x: state.contextMenuPopoverUi.point.x,
                              y: state.contextMenuPopoverUi.point.y,
                              width: 2,
                              height: 4,
                            },
                          });
                          state.closeContextMenu();
                        }}
                      />
                    </Suspense>
                  </div>
                )}
              </Popover.Description>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}

type Props = {
  extendContextValue: (layoutApi: GridApi) => void;
  persistedLayout: UiGridLayout;
};

/**
 * Portals do not transmit draggable handles.
 * Instead, UIs should use `uiClassName` to avoid being covered.
 */
const DraggableOverlay = () => <div className={cn(allowReactGridDragClassName, "absolute z-0 inset-0 cursor-move")} />;

function colFree(grid: Uint8Array[], col: number, y1: number, y2: number) {
  for (let r = y1; r < y2; r++) if (grid[r][col]) return false;
  return true;
}
function rowFree(grid: Uint8Array[], row: number, x1: number, x2: number) {
  for (let c = x1; c < x2; c++) if (grid[row][c]) return false;
  return true;
}

export type GridApi = UiContextValue["layoutApi"];

export type UiGridLayout = {
  breakpoints: Record<"lg" | "sm", number>;
  cols: Record<"lg" | "sm", number>;
  /** Only one layout but cols still responsive */
  layouts: Record<"lg", Layout>;
  toUi: { [layoutKey: string]: UiInstanceMeta };
};

type State = {
  dragging: boolean;
  contextMenuOpen: boolean;
  /** ContextMenu items may provide a "bootstrap ui" inside a Popover */
  contextMenuPopoverHandle: Popover.Handle<unknown>;
  contextMenuPopoverUi: null | {
    point: { x: number; y: number };
    uiKey: UiRegistryKey;
    ui: (props: UiBootstrapProps) => React.ReactNode;
  };
  gridConfig: Partial<GridConfig>;
  resizeMode: boolean;
  numTouches: number;
  overrideContextMenuOpts: null | OverrideContextMenuOpts;
  preventTransition: boolean;
  resizeConfig: {
    resizeMode: Partial<ResizeConfig>;
    default: Partial<ResizeConfig>;
  };
  resizing: boolean;
  visualViewportRect: null | { x: number; y: number; width: number; height: number };
  addItem(meta: AddUiItemOpts): void;
  closeContextMenu(): void;
  isGridContainer(el: HTMLElement): boolean;
  onChangeContextMenu(open: boolean, eventDetails: ContextMenu.Root.ChangeEventDetails): void;
  onClickItemLock(e: React.MouseEvent<HTMLButtonElement>): void;
  onContextMenuItem(e: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>): void;
  onDragStart(): void;
  onDragStop(): void;
  onResizeStart(): void;
  onResizeStop(): void;
  persist(): void;
  updateNumTouches(e: React.TouchEvent<HTMLElement>): void;
};
