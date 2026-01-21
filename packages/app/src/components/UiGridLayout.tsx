import { ContextMenu } from "@base-ui/react/context-menu";
import { Popover } from "@base-ui/react/popover";
import {
  UiInstance,
  type UiRegistryKey,
  uiBootstrapRegistry,
  uiRegistry,
  uiRegistryKeys,
} from "@npc-cli/ui__registry";
import type { UiBootstrapProps } from "@npc-cli/ui-sdk";
import { cn, Spinner, useStateRef, useUpdate } from "@npc-cli/util";
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
      contextMenuDiv: null,
      contextMenuPopoverHandle: Popover.createHandle(),
      dragging: false,
      gridConfig: {
        cols,
        rowHeight: 80,
        // margin: [10, 10],
      },
      uiBootstrap: null,
      isLocked: Object.fromEntries(initialUiLayout.layouts.lg.map((x) => [x.i, !x.isDraggable])),
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
        state.set({
          uiBootstrap: null,
          showContextMenu: false,
        });
      },
      focusChildPopover(e) {
        const child = e.currentTarget.children[0];
        if (child && child instanceof HTMLElement) child.focus();
      },
      async onContextMenuItem(e) {
        if (!containerRef.current || !state.contextMenuDiv) return;
        if (
          e.nativeEvent instanceof KeyboardEvent &&
          e.nativeEvent.key !== "Enter" &&
          e.nativeEvent.key !== " "
        )
          return;

        const uiRegistryKey = e.currentTarget.dataset.uiRegistryKey as UiRegistryKey;
        const { x: clientX, y: clientY } = state.contextMenuDiv.getBoundingClientRect();

        const containerRect = containerRef.current.getBoundingClientRect();
        const relativeX = clientX - containerRect.left;
        const relativeY = clientY - containerRect.top;
        const gridItemWidth = containerRef.current.clientWidth / cols;
        const gridItemHeight =
          (state.gridConfig.rowHeight || 150) + 2 * (state.gridConfig.margin?.[1] || 10);
        const gridX = Math.floor(relativeX / gridItemWidth);
        const gridY = Math.floor(relativeY / gridItemHeight);

        const ui = uiBootstrapRegistry[uiRegistryKey];

        if (ui) {
          // further details needed for instantiation
          e.stopPropagation();
          state.set({
            uiBootstrap: { uiKey: uiRegistryKey, ui, point: { x: gridX, y: gridY } },
          });
        } else {
          state.addItem({
            itemId: `ui-${crypto.randomUUID()}`,
            uiKey: uiRegistryKey,
            gridRect: { x: gridX, y: gridY, width: 2, height: 2 },
          });
        }
      },
      onContextMenu(e) {
        if (
          !containerRef.current ||
          (e.target as HTMLElement).parentElement !== containerRef.current ||
          state.showContextMenu
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
      removeItem(itemId) {
        delete state.toUi[itemId];
        layouts.current.lg = layout.filter((item) => item.i !== itemId);
        setLayouts({ lg: layout.filter((item) => item.i !== itemId) });
      },
      set(partial: Partial<State>) {
        Object.assign(state, partial);
        update();
      },
    }),
    { deps: [layout], reset: { gridConfig: true } },
  );

  useEffect(state.onMount, [state.onMount]);
  const update = useUpdate();

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
    <>
      <ContextMenu.Root
        onOpenChange={(open, _eventDetails) => {
          !open && state.contextMenuPopoverHandle.close();
        }}
      >
        <ContextMenu.Trigger className="size-full">
          <div
            ref={containerRef}
            className="relative size-full overflow-auto"
            onContextMenu={(e) => {
              if ((e.target as HTMLElement) !== containerRef.current?.childNodes[0]) {
                e.stopPropagation(); // only open onclick background
              }
            }}
          >
            <GridLayout
              className={cn(
                state.preventTransition && "[&_.react-grid-item]:transition-none!",
                (state.resizing || state.dragging || state.showContextMenu) && "select-none",
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
              {childDefs.map((def) => (
                <div key={def.itemId} data-item-id={def.itemId} className="relative border">
                  <Suspense fallback={<Spinner />}>
                    <UiInstance id={def.itemId} uiKey={def.uiKey} />
                  </Suspense>
                  <UiInstanceMenu id={def.itemId} state={state} />
                </div>
              ))}
            </GridLayout>
          </div>
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner>
            <ContextMenu.Popup
              ref={state.ref("contextMenuDiv")}
              className="flex flex-col rounded-md bg-black/60 text-white outline-black"
            >
              {uiRegistryKeys.map((uiRegistryKey) => (
                <ContextMenu.Item
                  key={uiRegistryKey}
                  data-ui-registry-key={uiRegistryKey}
                  className="hover:bg-white/20 first:rounded-t-md last:rounded-b-md not-last:border-b border-white/20 outline-black lowercase text-left tracking-widest"
                  closeOnClick={!uiBootstrapRegistry[uiRegistryKey]}
                  onClick={state.onContextMenuItem} // 🚧
                  onFocus={uiBootstrapRegistry[uiRegistryKey] ? state.focusChildPopover : undefined}
                >
                  <Popover.Trigger
                    className="w-full px-4 py-1.5 text-left cursor-pointer"
                    handle={state.contextMenuPopoverHandle}
                    tabIndex={-1}
                  >
                    {uiRegistryKey}
                  </Popover.Trigger>
                </ContextMenu.Item>
              ))}
            </ContextMenu.Popup>
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>

      <Popover.Root handle={state.contextMenuPopoverHandle}>
        <Popover.Portal>
          <Popover.Positioner side="right" sideOffset={8}>
            <Popover.Popup className="bg-white">
              <Popover.Arrow
                className={cn(
                  "flex",
                  "data-[side=top]:top-2 data-[side=top]:rotate-180",
                  "data-[side=bottom]:-top-2 data-[side=bottom]:rotate-0",
                  "data-[side=left]:right-[-13px] data-[side=left]:rotate-90",
                  "data-[side=right]:left-[-13px] data-[side=right]:-rotate-90",
                )}
              >
                <ArrowSvg />
              </Popover.Arrow>
              {/* <Popover.Title>Create...</Popover.Title> */}
              <Popover.Description className="bg-black">
                {state.uiBootstrap && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <Suspense fallback={<Spinner />}>
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1, transition: { duration: 0.5 } }}
                      >
                        <state.uiBootstrap.ui
                          addInstance={() => {
                            // 🚧
                            state.uiBootstrap &&
                              state.addItem({
                                itemId: `ui-${crypto.randomUUID()}`,
                                uiKey: state.uiBootstrap.uiKey,
                                gridRect: {
                                  x: state.uiBootstrap.point.x,
                                  y: state.uiBootstrap.point.y,
                                  width: 2,
                                  height: 2,
                                },
                              });
                            state.set({ showContextMenu: false });
                          }}
                        />
                      </motion.div>
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

/** https://base-ui.com/react/components/popover */
function ArrowSvg(props: React.ComponentProps<"svg">) {
  return (
    <svg width="20" height="10" viewBox="0 0 20 10" fill="none" {...props}>
      <title>Arrow for popover</title>
      <path
        d="M9.66437 2.60207L4.80758 6.97318C4.07308 7.63423 3.11989 8 2.13172 8H0V10H20V8H18.5349C17.5468 8 16.5936 7.63423 15.8591 6.97318L11.0023 2.60207C10.622 2.2598 10.0447 2.25979 9.66437 2.60207Z"
        className="fill-white"
      />
      <path
        d="M8.99542 1.85876C9.75604 1.17425 10.9106 1.17422 11.6713 1.85878L16.5281 6.22989C17.0789 6.72568 17.7938 7.00001 18.5349 7.00001L15.89 7L11.0023 2.60207C10.622 2.2598 10.0447 2.2598 9.66436 2.60207L4.77734 7L2.13171 7.00001C2.87284 7.00001 3.58774 6.72568 4.13861 6.22989L8.99542 1.85876Z"
        className="fill-white"
      />
      <path
        d="M10.3333 3.34539L5.47654 7.71648C4.55842 8.54279 3.36693 9 2.13172 9H0V8H2.13172C3.11989 8 4.07308 7.63423 4.80758 6.97318L9.66437 2.60207C10.0447 2.25979 10.622 2.2598 11.0023 2.60207L15.8591 6.97318C16.5936 7.63423 17.5468 8 18.5349 8H20V9H18.5349C17.2998 9 16.1083 8.54278 15.1901 7.71648L10.3333 3.34539Z"
        className="fill-white"
      />
    </svg>
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
  contextMenuDiv: null | HTMLDivElement;
  contextMenuPopoverHandle: Popover.Handle<unknown>;
  gridConfig: Partial<GridConfig>;
  uiBootstrap: null | {
    uiKey: UiRegistryKey;
    ui: (props: UiBootstrapProps) => React.ReactNode;
    point: { x: number; y: number };
  };
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
  focusChildPopover(e: React.FocusEvent<HTMLElement>): void;
  onMount(): (() => void) | void;
  onResizeStart(): void;
  onResizeStop(): void;
  onContextMenuItem(e: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>): void;
  onContextMenu(e: MouseEvent | React.MouseEvent<HTMLElement>): void;
  onDragStart(): void;
  onDragStop(): void;
  onClickItemDelete(e: React.MouseEvent<HTMLButtonElement>): void;
  onClickItemLock(e: React.MouseEvent<HTMLButtonElement>): void;
  removeItem(itemId: string): void;
  set(partial: Partial<State>): void;
};

function UiInstanceMenu({ id, state }: { id: string; state: State }) {
  return (
    <div
      className={cn(
        "z-999 absolute bottom-1 left-1 filter backdrop-blur-lg",
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

      <button
        type="button"
        data-item-id={id}
        className="cursor-pointer p-1"
        onPointerDown={state.onClickItemDelete}
      >
        <XIcon data-icon-type="remove" weight="duotone" className="grayscale" />
      </button>
    </div>
  );
}
