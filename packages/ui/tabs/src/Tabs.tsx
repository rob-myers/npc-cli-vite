import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
import { Select } from "@base-ui/react/select";
import type { UiInstanceMeta } from "@npc-cli/ui-sdk";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { UiInstanceMenu } from "@npc-cli/ui-sdk/UiInstanceMenu";
import { BasicPopover, cn, useStateRef } from "@npc-cli/util";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { pause } from "@npc-cli/util/legacy/generic";
import { DotsThreeOutlineVerticalIcon, PlayCircleIcon, PlusCircleIcon, TrashIcon } from "@phosphor-icons/react";
import { useContext, useEffect, useMemo, useRef } from "react";
import * as portals from "react-reverse-portal";
import { useStore } from "zustand";
import type { TabsUiMeta } from "./schema";

export default function Tabs({ meta }: { meta: TabsUiMeta }): React.ReactNode {
  const { layoutApi, uiRegistry, uiStore, uiStoreApi } = useContext(UiContext);
  const rootRef = useRef<HTMLDivElement>(null);
  const newTabButtonRef = useRef<HTMLButtonElement>(null);
  const tabBarRef = useRef<HTMLDivElement>(null);

  const byId = useStore(uiStore, (s) => s.byId);

  const state = useStateRef(
    () => ({
      isDropTarget: false,
      onAddNewTab(e: React.MouseEvent<HTMLElement>) {
        e.stopPropagation();
        pause(30); // avoid immediate select context menu item

        layoutApi.overrideContextMenu({
          refObject: newTabButtonRef,
          addItem({ uiMeta: subUiMeta }) {
            const result = uiRegistry[subUiMeta.uiKey].schema.safeParse(subUiMeta);

            if (!result.success) {
              return console.error("Failed to parse tab meta", result.error);
            }
            if (result.data.uiKey === "Tabs") {
              return console.error("Nested Tabs unsupported");
            }

            result.data.parentId = meta.id;
            // inherit disabled to keep in sync
            result.data.disabled = uiStoreApi.getUi(meta.id)?.meta?.disabled;
            uiStoreApi.addUis({ metas: [result.data] });

            uiStore.setState((draft) => {
              const tabsMeta = draft.byId[meta.id].meta as TabsUiMeta;
              tabsMeta.items.push(result.data.id);
              tabsMeta.currentTabId = result.data.id;
            });
          },
        });
      },
      onClickTab(tab: UiInstanceMeta) {
        uiStore.setState((draft) => {
          (draft.byId[meta.id].meta as TabsUiMeta).currentTabId = tab.id;
        });
      },
      onContextMenu(e: React.MouseEvent<HTMLElement>) {
        e.preventDefault();
        e.stopPropagation();

        if (isTouchDevice()) return;

        pause(30);

        const rect = DOMRect.fromRect({ x: e.clientX, y: e.clientY, width: 0, height: 0 });
        layoutApi.overrideContextMenu({
          refObject: { getBoundingClientRect: () => rect },
          addItem({ uiMeta: subUiMeta }) {
            const result = uiRegistry[subUiMeta.uiKey].schema.safeParse(subUiMeta);

            if (!result.success) {
              return console.error("Failed to parse tab meta", result.error);
            }
            if (result.data.uiKey === "Tabs") {
              return console.error("Nested Tabs unsupported");
            }

            result.data.parentId = meta.id;
            result.data.disabled = uiStoreApi.getUi(meta.id)?.meta?.disabled;
            uiStoreApi.addUis({ metas: [result.data] });

            uiStore.setState((draft) => {
              const tabsMeta = draft.byId[meta.id].meta as TabsUiMeta;
              tabsMeta.items.push(result.data.id);
              tabsMeta.currentTabId = result.data.id;
            });
          },
        });
      },
      onDeleteTab(tab: UiInstanceMeta) {
        uiStore.setState((draft) => {
          const rootMeta = draft.byId[meta.id].meta as TabsUiMeta;
          const prevIndex = rootMeta.items.indexOf(tab.id);
          rootMeta.items = rootMeta.items.filter((id) => id !== tab.id);
          if (rootMeta.currentTabId === tab.id) {
            rootMeta.currentTabId = rootMeta.items[prevIndex - 1] ?? rootMeta.items[0];
          }
        });
        uiStoreApi.removeItem(tab.id);
      },
    }),
    { deps: [meta, layoutApi] },
  );

  // Root-level drop target so drops anywhere on this Tabs are "handled"
  useEffect(() => {
    if (!rootRef.current) return;
    return dropTargetForElements({
      element: rootRef.current,
      canDrop: ({ source }) => source.data.type === "tab",
    });
  }, []);

  useEffect(() => {
    const el = tabBarRef.current;
    if (!el) return;

    return dropTargetForElements({
      element: el,
      canDrop: ({ source }) => source.data.type === "tab",
      onDragEnter: () => state.set({ isDropTarget: true }),
      onDragLeave: () => state.set({ isDropTarget: false }),
      onDrop: ({ source }) => {
        state.set({ isDropTarget: false });
        const draggedId = source.data.id as string;
        const sourceTabsMetaId = source.data.tabsMetaId as string;

        // Don't do anything if dropping within the same Tabs instance
        if (sourceTabsMetaId === meta.id) return;

        // Move tab from source to end of target Tabs
        const sourceWasEmptied = moveTabBetweenPanes(uiStore, {
          draggedId,
          sourceTabsMetaId,
          targetTabsMetaId: meta.id,
        });
        if (sourceWasEmptied) layoutApi.closePane(sourceTabsMetaId);
      },
    });
  }, [meta.id]);

  useEffect(() => {
    uiStore.setState((draft) => {
      const item = draft.byId?.[meta.currentTabId ?? ""];
      if (item) item.everSeen = true;
    });
  }, [meta.currentTabId]); // lazy mount

  const hasMounted = useRef(false);
  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      return;
    }
    const content = rootRef.current?.querySelector<HTMLElement>(`[data-tab-content="${meta.currentTabId}"]`);
    if (!content) return;
    const focusTarget = content.querySelector<HTMLElement>('[tabindex]:not([tabindex="-1"])') ?? content;
    focusTarget.focus();
  }, [meta.currentTabId]); // focus e.g. key events

  const tabs = meta.items.map((itemId) => byId[itemId]?.meta).filter(Boolean);

  return (
    <div ref={rootRef} className="flex flex-col size-full overflow-auto font-mono">
      <div
        className="flex justify-between min-h-10 w-full border-b border-on-background/30 border-outline"
        onContextMenu={state.onContextMenu}
      >
        <div
          ref={tabBarRef}
          className={cn(
            "w-full", // easier drag between tabs
            "flex items-end overflow-x-auto [scrollbar-width:thin] touch-pan-x",
            state.isDropTarget && "bg-blue-400/10",
          )}
        >
          {tabs.map((tab) => (
            <TabHeaderItem
              key={tab.id}
              tab={tab}
              isCurrentTab={meta.currentTabId === tab.id}
              onClickTab={() => state.onClickTab(tab)}
              onDeleteTab={() => state.onDeleteTab(tab)}
              tabsMetaId={meta.id}
              uiStore={uiStore}
              uiStoreApi={uiStoreApi}
            />
          ))}
          <button ref={newTabButtonRef} type="button" className="cursor-pointer p-2" onClick={state.onAddNewTab}>
            <PlusCircleIcon className="size-6 text-on-background/60" weight="duotone" />
          </button>
        </div>
        {/* 🗑️ ... */}
        <UiInstanceMenu meta={meta} className="self-end" />
      </div>

      <div
        className="pt-0 px-0 flex-1 size-full overflow-auto"
        onContextMenu={tabs.length === 0 ? state.onContextMenu : undefined}
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            data-tab-content={tab.id}
            tabIndex={-1}
            className={cn("size-full outline-none", tab.id !== meta.currentTabId && "hidden")}
          >
            {byId[tab.id] && meta.currentTabId === tab.id && (
              <portals.OutPortal key={tab.id} node={byId[tab.id].portal.portalNode} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

interface TabHeaderItemProps {
  tab: UiInstanceMeta;
  isCurrentTab: boolean;
  onClickTab: () => void;
  onDeleteTab: () => void;
  tabsMetaId: string;
  uiStore: typeof import("@npc-cli/ui-sdk/ui.store").uiStore;
  uiStoreApi: typeof import("@npc-cli/ui-sdk/ui.store").uiStoreApi;
}

function TabHeaderItem({
  tab,
  isCurrentTab,
  onClickTab,
  onDeleteTab,
  tabsMetaId,
  uiStore,
  uiStoreApi,
}: TabHeaderItemProps) {
  const { layoutApi } = useContext(UiContext);
  const byId = useStore(uiStore, (s) => s.byId);
  const allTabs = useMemo(
    () =>
      Object.values(byId)
        .filter(({ meta: m }) => m.uiKey === "Tabs")
        .map(({ meta: m }) => m),
    [byId],
  );

  const state = useStateRef(() => ({
    tabEl: null as HTMLDivElement | null,
    isDragging: false,
    isDropTarget: false,
  }));

  useEffect(() => {
    const el = state.tabEl;
    if (!el) return;
    const id = tab.id;
    const touchCleanup = setupTouchLongPressDrag(el);

    return combine(
      draggable({
        element: el,
        getInitialData: () => ({ type: "tab", id, tabsMetaId }),
        onGenerateDragPreview: ({ nativeSetDragImage }) => {
          setCustomNativeDragPreview({
            nativeSetDragImage,
            render: ({ container }) => {
              const preview = document.createElement("div");
              Object.assign(preview.style, {
                width: "100px",
                height: "80px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--color-background, #222)",
                color: "var(--color-on-background, #fff)",
                border: "2px solid rgba(255,255,255,0.5)",
                fontFamily: "monospace",
                fontSize: "12px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                padding: "8px",
                textAlign: "center",
                wordBreak: "break-word",
              });
              preview.textContent = tab.title ?? id;
              container.appendChild(preview);
            },
          });
        },
        onDragStart: () => state.set({ isDragging: true }),
        onDrop: () => {
          state.set({ isDragging: false });
          touchCleanup.resetDraggable();
        },
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => source.data.type === "tab" && source.data.id !== id,
        onDragEnter: () => state.set({ isDropTarget: true }),
        onDragLeave: () => state.set({ isDropTarget: false }),
        onDrop: ({ source }) => {
          state.set({ isDropTarget: false });
          const draggedId = source.data.id as string;
          const sourceTabsMetaId = source.data.tabsMetaId as string;
          if (draggedId === id) return;

          // Check if moving within the same Tabs instance or between different ones
          if (sourceTabsMetaId === tabsMetaId) {
            // Reorder within same Tabs instance
            uiStoreApi.setUiMeta(tabsMetaId, (draft) => {
              if (!draft.items) return;
              const draggedIndex = draft.items.indexOf(draggedId);
              const targetIndex = draft.items.indexOf(id);
              // Remove dragged item
              draft.items.splice(draggedIndex, 1);
              // Insert at target position
              draft.items.splice(targetIndex, 0, draggedId);
            });
          } else {
            // Move tab between different Tabs instances
            const sourceWasEmptied = moveTabBetweenPanes(uiStore, {
              draggedId,
              sourceTabsMetaId,
              targetTabsMetaId: tabsMetaId,
              insertBeforeId: id,
            });
            if (sourceWasEmptied) layoutApi.closePane(sourceTabsMetaId);
          }
        },
      }),
      touchCleanup,
    );
  }, [tab.id, tabsMetaId]);

  return (
    <div
      ref={state.ref("tabEl")}
      className={cn(
        "cursor-pointer shrink-0 px-1 border-b-2 border-outline font-medium text-sm focus:outline-none",
        !isCurrentTab && "opacity-50 hover:opacity-80",
        state.isDragging && "opacity-30",
        state.isDropTarget && "border-l-2 border-l-blue-400",
      )}
      onClick={onClickTab}
    >
      <div className={"flex items-center px-1 py-0.5 border text-sm border-on-background/20"}>
        <pre className="p-1">{tab.title}</pre>

        {isCurrentTab && (
          <>
            <BasicPopover
              trigger={
                <DotsThreeOutlineVerticalIcon weight="thin" className="cursor-pointer size-4 text-on-background/80" />
              }
              className="bg-gray-700 py-0.5 px-1 flex flex-col"
              positionerClassName="z-10000"
              arrowClassName="fill-gray-700"
              side="bottom"
              sideOffset={8}
            >
              <div className="flex items-center gap-2 px-2 py-1">
                {allTabs.length > 1 && (
                  <Select.Root
                    value={allTabs.find((t) => t.id === tabsMetaId)?.title ?? ""}
                    onValueChange={(title) => {
                      const target = allTabs.find((t) => t.title === title);
                      if (!target || target.id === tabsMetaId) return;

                      const sourceWasEmptied = moveTabBetweenPanes(uiStore, {
                        draggedId: tab.id,
                        sourceTabsMetaId: tabsMetaId,
                        targetTabsMetaId: target.id,
                        copyDisabled: true,
                      });
                      if (sourceWasEmptied) layoutApi.closePane(tabsMetaId);
                    }}
                  >
                    <Select.Trigger className="flex items-center gap-1 text-sm text-white bg-gray-600 px-2 cursor-pointer outline-none">
                      <Select.Value placeholder="Move to..." />
                    </Select.Trigger>
                    <Select.Portal>
                      <Select.Positioner className="z-10000" sideOffset={4}>
                        <Select.Popup
                          className="bg-black border border-white/20 rounded shadow-lg py-1"
                          // must prevent selection from selecting current tab
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Select.List>
                            {allTabs.map((t) => (
                              <Select.Item
                                key={t.id}
                                value={t.title}
                                className={cn(
                                  "px-3 py-1 text-sm cursor-pointer text-white",
                                  "data-highlighted:bg-white/20 data-selected:text-blue-400",
                                )}
                              >
                                <Select.ItemText>{t.title}</Select.ItemText>
                              </Select.Item>
                            ))}
                          </Select.List>
                        </Select.Popup>
                      </Select.Positioner>
                    </Select.Portal>
                  </Select.Root>
                )}

                {/* 🗑️ */}
                <button
                  type="button"
                  className="cursor-pointer text-white/80 hover:text-white"
                  onPointerDown={onDeleteTab}
                >
                  <TrashIcon className="size-4" />
                </button>
              </div>
            </BasicPopover>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                uiStoreApi.setUiMeta(tab.id, (draft) => (draft.disabled = !draft.disabled));
              }}
            >
              <PlayCircleIcon
                weight="duotone"
                className={cn("size-5 cursor-pointer mr-0.5", tab.disabled ? "text-gray-500" : "text-green-700")}
              />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function moveTabBetweenPanes(
  uiStore: typeof import("@npc-cli/ui-sdk/ui.store").uiStore,
  opts: {
    draggedId: string;
    sourceTabsMetaId: string;
    targetTabsMetaId: string;
    insertBeforeId?: string;
    copyDisabled?: boolean;
  },
): boolean {
  let sourceWasEmptied = false;
  uiStore.setState((draft) => {
    const sourceMeta = draft.byId[opts.sourceTabsMetaId]?.meta as TabsUiMeta | undefined;
    const targetMeta = draft.byId[opts.targetTabsMetaId]?.meta as TabsUiMeta | undefined;
    const draggedTab = draft.byId[opts.draggedId];
    if (!sourceMeta || !targetMeta || !draggedTab) return;
    if (targetMeta.items.includes(opts.draggedId)) return;

    sourceMeta.items = sourceMeta.items.filter((id) => id !== opts.draggedId);
    if (sourceMeta.currentTabId === opts.draggedId) {
      sourceMeta.currentTabId = sourceMeta.items[0];
    }
    sourceWasEmptied = sourceMeta.items.length === 0;

    draggedTab.meta.parentId = opts.targetTabsMetaId;
    if (opts.copyDisabled) draggedTab.meta.disabled = targetMeta.disabled;

    if (opts.insertBeforeId !== undefined) {
      const idx = targetMeta.items.indexOf(opts.insertBeforeId);
      targetMeta.items.splice(idx !== -1 ? idx : targetMeta.items.length, 0, opts.draggedId);
    } else {
      targetMeta.items.push(opts.draggedId);
    }

    targetMeta.currentTabId = opts.draggedId;
  });
  return sourceWasEmptied;
}

const noopTouchCleanup = Object.assign(() => {}, { resetDraggable() {} });

/** On touch devices, only allow drag after a 300ms long press. */
function setupTouchLongPressDrag(el: HTMLElement) {
  if (!("ontouchstart" in window)) return noopTouchCleanup;

  let timer = 0;
  const setDrag = (v: boolean) => el.setAttribute("draggable", String(v));
  const cancel = () => {
    clearTimeout(timer);
    setDrag(false);
  };
  const start = () => {
    timer = window.setTimeout(() => setDrag(true), 300);
  };

  setDrag(false);
  el.addEventListener("touchstart", start, { passive: true });
  el.addEventListener("touchmove", cancel, { passive: true });
  el.addEventListener("touchend", cancel);

  return Object.assign(
    () => {
      cancel();
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", cancel);
      el.removeEventListener("touchend", cancel);
    },
    { resetDraggable: () => setDrag(false) },
  );
}
