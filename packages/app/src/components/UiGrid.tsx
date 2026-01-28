import { ContextMenu } from "@base-ui/react/context-menu";
import { Popover } from "@base-ui/react/popover";
import { UiInstance, type UiRegistryKey, uiRegistry, uiRegistryKeys } from "@npc-cli/ui__registry";
import type { UiBootstrapProps, UiInstanceMeta } from "@npc-cli/ui-sdk";
import { BasicPopover, cn, PopoverArrow, Spinner, useStateRef } from "@npc-cli/util";
import { pause } from "@npc-cli/util/legacy/generic";
import { LockIcon, XIcon } from "@phosphor-icons/react";
import { motion } from "motion/react";
import type React from "react";
import { Suspense, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { GridLayout, type Layout, useContainerWidth, useResponsiveLayout } from "react-grid-layout";
import type { GridConfig } from "react-grid-layout/core";

import { layoutStore } from "./layout.store";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

export function UiGrid({ uiLayout: initialUiLayout, ref }: Props) {
  const layouts = useRef(initialUiLayout.layouts);

  const { width, containerRef } = useContainerWidth({
    initialWidth: window.innerWidth, // avoid initial animation
  });

  const { layout, cols, setLayouts } = useResponsiveLayout({
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
      contextMenuOpen: false,
      contextMenuPopoverHandle: Popover.createHandle(),
      contextMenuPopoverUi: null,
      dragging: false,
      gridConfig: {
        cols,
        rowHeight: 80,
        // margin: [10, 10],
      },
      isLocked: Object.fromEntries(initialUiLayout.layouts.lg.map((x) => [x.i, !x.isDraggable])),
      numTouches: 0,
      preventTransition: true,
      resizing: false,
      toUi: { ...initialUiLayout.toUi },
      visualViewportRect: null,
      addItem({ itemId, uiMeta, gridRect }) {
        state.toUi[itemId] = uiMeta;
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
        state.set({
          contextMenuPopoverUi: null,
          contextMenuOpen: false,
        });
        state.contextMenuPopoverHandle.close();
      },
      isGridParent(el) {
        return el === containerRef.current?.childNodes[0];
      },
      onChangeContextMenu(open, eventDetails) {
        if (!open) {
          state.contextMenuPopoverHandle.close();
        } else if (!state.isGridParent(eventDetails.event.target as HTMLElement)) {
          return; // ignore long press on grid children
        }
        if (state.numTouches > 1) {
          return; // try avoid pinch zoom
        }

        state.set({ contextMenuOpen: open });
      },
      onClickItemDelete(e) {
        e.stopPropagation();
        const itemId = e.currentTarget.dataset.itemId as string;
        state.removeItem(itemId);
      },
      onClickItemLock(e) {
        e.stopPropagation();
        const itemId = e.currentTarget.dataset.itemId as string;
        const locked = (state.isLocked[itemId] = !state.isLocked[itemId]);
        setLayouts({
          lg: layouts.current.lg.map((item) =>
            item.i === itemId
              ? {
                  ...item,
                  isDraggable: !locked,
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
        const gridItemHeight =
          (state.gridConfig.rowHeight || 150) + 2 * (state.gridConfig.margin?.[1] || 10);
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
          const itemId = `ui-${crypto.randomUUID()}`;
          state.addItem({
            itemId,
            uiMeta: {
              layoutId: itemId,
              uiKey: uiRegistryKey,
            },
            gridRect: { x: gridX, y: gridY, width: 2, height: 2 },
          });
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
      removeItem(itemId) {
        delete state.toUi[itemId];
        layouts.current.lg = layout.filter((item) => item.i !== itemId);
        setLayouts({ lg: layout.filter((item) => item.i !== itemId) });
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
      layoutStore.setState({ ready: true });
    });

    // Fix hidden ContextMenu on mobile keyboard
    function onChangeVisualViewport() {
      window.visualViewport &&
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
        state.toUi = { "ui-0": { layoutId: "ui-0", uiKey: "Global" } };
        state.isLocked = {};
        layouts.current = { lg: [{ i: "ui-0", w: 2, h: 1, x: 0, y: 0 }] };
        setLayouts({
          lg: { ...layouts.current.lg },
        });
      },
    }),
    [],
  );

  const childDefs = useMemo(
    () =>
      layout.map((item) => ({
        uiMeta: state.toUi[item.i],
        ui: uiRegistry[state.toUi[item.i]?.uiKey],
      })),
    [layout],
  );

  return (
    <>
      <ContextMenu.Root open={state.contextMenuOpen} onOpenChange={state.onChangeContextMenu}>
        <ContextMenu.Trigger className="size-full">
          <div
            ref={containerRef}
            className="relative size-full overflow-auto"
            onContextMenu={(e) => {
              if (!state.isGridParent(e.target as HTMLElement)) {
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
                "h-full! text-on-background/60 [&_.react-resizable-handle::after]:border-on-background!",
                // "[&_.react-resizable-handle::after]:z-200",
                // "[&_.react-resizable-handle::after]:size-4!",
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
                layouts.current.lg = layout;
              }}
            >
              {childDefs.map(({ uiMeta }) => (
                <div
                  key={uiMeta.layoutId}
                  data-item-id={uiMeta.layoutId}
                  className="relative border border-on-background/20"
                >
                  <Suspense fallback={<Spinner />}>
                    <UiInstance meta={uiMeta} />
                  </Suspense>
                  <UiInstanceMenu id={uiMeta.layoutId} state={state} />
                </div>
              ))}
            </GridLayout>
          </div>
        </ContextMenu.Trigger>

        <ContextMenu.Portal>
          <ContextMenu.Positioner collisionBoundary={state.visualViewportRect ?? undefined}>
            <ContextMenu.Popup
              className="flex flex-col rounded-md bg-black/60 text-white outline-black"
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
                    if (
                      e.key === "Enter" ||
                      e.key === " " ||
                      e.key === "ArrowLeft" ||
                      e.key === "ArrowRight"
                    ) {
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
                    <div className="w-full px-4 py-1.5 text-left cursor-pointer">
                      {uiRegistryKey}
                    </div>
                  )}
                </ContextMenu.Item>
              ))}
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <Popover.Root handle={state.contextMenuPopoverHandle}>
        <Popover.Portal>
          <Popover.Positioner side="right" sideOffset={8}>
            <Popover.Popup initialFocus={false}>
              <PopoverArrow />
              <Popover.Viewport className="bg-black">
                {state.contextMenuPopoverUi && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <Suspense fallback={<Spinner />}>
                      <motion.div // 🚧 try css transition instead
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1, transition: { duration: 0.5 } }}
                      >
                        <state.contextMenuPopoverUi.ui
                          addInstance={(partialUiMeta) => {
                            if (!state.contextMenuPopoverUi) return;

                            const itemId = `ui-${crypto.randomUUID()}`;

                            state.addItem({
                              itemId,
                              uiMeta: {
                                ...partialUiMeta,
                                layoutId: itemId,
                                uiKey: state.contextMenuPopoverUi.uiKey,
                              },
                              gridRect: {
                                x: state.contextMenuPopoverUi.point.x,
                                y: state.contextMenuPopoverUi.point.y,
                                width: 2,
                                height: 2,
                              },
                            });
                            state.closeContextMenu();
                          }}
                        />
                      </motion.div>
                    </Suspense>
                  </div>
                )}
              </Popover.Viewport>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </>
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
  isLocked: { [layoutKey: string]: boolean };
  numTouches: number;
  preventTransition: boolean;
  resizing: boolean;
  toUi: UiGridLayout["toUi"];
  visualViewportRect: null | { x: number; y: number; width: number; height: number };
  addItem(meta: {
    itemId: string;
    uiMeta: UiInstanceMeta;
    gridRect: { x: number; y: number; width: number; height: number };
  }): void;
  closeContextMenu(): void;
  isGridParent(el: HTMLElement): boolean;
  onChangeContextMenu(open: boolean, eventDetails: ContextMenu.Root.ChangeEventDetails): void;
  onClickItemDelete(e: React.MouseEvent<HTMLElement>): void;
  onClickItemLock(e: React.MouseEvent<HTMLButtonElement>): void;
  onContextMenuItem(e: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>): void;
  onDragStart(): void;
  onDragStop(): void;
  onResizeStart(): void;
  onResizeStop(): void;
  removeItem(itemId: string): void;
  updateNumTouches(e: React.TouchEvent<HTMLElement>): void;
};

function UiInstanceMenu({ id, state }: { id: string; state: State }) {
  return (
    <div
      className={cn(
        "z-999 absolute bottom-1 left-1 filter backdrop-blur-lg backdrop-brightness-140",
        "flex text-teal-500 bg-on-background/5 rounded",
      )}
    >
      <button
        type="button"
        data-item-id={id}
        className={cn("cursor-pointer p-1", !state.isLocked[id] && "grayscale")}
        onPointerDown={state.onClickItemLock}
      >
        <LockIcon data-icon-type="lock" weight="duotone" />
      </button>

      <BasicPopover
        trigger={<XIcon data-icon-type="remove" weight="duotone" className="grayscale" />}
        sideOffset={4}
        side="right"
      >
        <button
          type="button"
          className="cursor-pointer"
          onPointerDown={state.onClickItemDelete}
          data-item-id={id}
        >
          confirm
        </button>
      </BasicPopover>
    </div>
  );
}
