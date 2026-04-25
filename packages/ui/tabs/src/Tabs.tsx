import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
import { preventUnhandled } from "@atlaskit/pragmatic-drag-and-drop/prevent-unhandled";
import type { UiInstanceMeta } from "@npc-cli/ui-sdk";
import { uiClassName } from "@npc-cli/ui-sdk/const";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { UiInstanceMenu } from "@npc-cli/ui-sdk/UiInstanceMenu";
import { BasicPopover, cn, useStateRef } from "@npc-cli/util";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { pause } from "@npc-cli/util/legacy/generic";
import {
  ArrowUpRightIcon,
  DotsThreeOutlineVerticalIcon,
  PlayCircleIcon,
  PlusCircleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
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

            // portals with parentId not displayed in UiGrid
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
      onBreakOutTab(tab: UiInstanceMeta) {
        state.onDeleteTab(tab, { preservePortal: true });

        uiStore.setState((draft) => {
          const item = draft.byId[tab.id];
          if (item) item.meta.parentId = undefined;
        });
        layoutApi.appendLayoutItems([{ i: tab.id, x: 0, y: 0, w: 2, h: 4, ...layoutApi.getUiGridRect(meta.id) }]);
        requestAnimationFrame(() => layoutApi.fitItem(tab.id));
      },
      onClickTab(tab: UiInstanceMeta) {
        uiStore.setState((draft) => {
          (draft.byId[meta.id].meta as TabsUiMeta).currentTabId = tab.id;
        });
      },
      onDeleteTab(tab: UiInstanceMeta, { preservePortal }: { preservePortal: boolean }) {
        uiStore.setState((draft) => {
          const rootMeta = draft.byId[meta.id].meta as TabsUiMeta;
          const prevIndex = rootMeta.items.indexOf(tab.id);
          rootMeta.items = rootMeta.items.filter((id) => id !== tab.id);
          if (rootMeta.currentTabId === tab.id) {
            rootMeta.currentTabId = rootMeta.items[prevIndex - 1] ?? rootMeta.items[0];
          }
          if (!preservePortal) {
            delete draft.byId[tab.id];
          }
        });
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
        uiStore.setState((draft) => {
          const sourceMeta = draft.byId[sourceTabsMetaId]?.meta as TabsUiMeta | undefined;
          const targetMeta = draft.byId[meta.id]?.meta as TabsUiMeta | undefined;
          const draggedTab = draft.byId[draggedId];

          if (!sourceMeta || !targetMeta || !draggedTab) return;

          // Don't add if already in target (prevents duplicate when TabItem handler already ran)
          if (targetMeta.items.includes(draggedId)) return;

          // Remove from source Tabs
          sourceMeta.items = sourceMeta.items.filter((itemId) => itemId !== draggedId);
          // Update current tab if needed
          if (sourceMeta.currentTabId === draggedId) {
            sourceMeta.currentTabId = sourceMeta.items[0];
          }

          // Add to end of target Tabs
          targetMeta.items.push(draggedId);

          // Update the tab's parentId
          draggedTab.meta.parentId = meta.id;

          // Set as current tab in target Tabs
          targetMeta.currentTabId = draggedId;
        });
      },
    });
  }, [meta.id]);

  // Dragging a tab outside all Tabs containers breaks it out onto the grid
  useEffect(() => {
    return monitorForElements({
      canMonitor: ({ source }) => source.data.type === "tab" && source.data.tabsMetaId === meta.id,
      onDragStart() {
        preventUnhandled.start();
      },
      onDrop({ source, location }) {
        preventUnhandled.stop();
        // If dropped on any drop target (another Tabs bar or tab item), let those handlers handle it
        if (location.current.dropTargets.length > 0) return;

        if (isTouchDevice()) return; // cannot drag tab outside on mobile

        // Only break out if dropped directly on the grid, not over another UI
        const { clientX, clientY } = location.current.input;
        const elUnder = document.elementFromPoint(clientX, clientY);
        if (elUnder?.closest(".react-grid-item")) return;

        const tabId = source.data.id as string;
        const gridPos = layoutApi.screenToGrid(clientX, clientY);

        state.onDeleteTab({ id: tabId } as UiInstanceMeta, { preservePortal: true });
        uiStore.setState((draft) => {
          const item = draft.byId[tabId];
          if (item) {
            item.meta.parentId = undefined;
            item.everSeen = true;
          }
        });
        layoutApi.appendLayoutItems([{ i: tabId, x: gridPos?.x ?? 0, y: gridPos?.y ?? 0, w: 2, h: 4 }]);
        requestAnimationFrame(() => layoutApi.fitItem(tabId));
      },
    });
  }, [meta.id]);

  useEffect(() => {
    uiStore.setState((draft) => {
      const item = draft.byId?.[meta.currentTabId ?? ""];
      if (item) item.everSeen = true;
    });
  }, [meta.currentTabId]); // lazy mount

  const tabs = meta.items.map((itemId) => byId[itemId]?.meta).filter(Boolean);

  return (
    <div ref={rootRef} className="flex flex-col size-full overflow-auto font-mono">
      <div className="flex justify-between min-h-12 w-full border-b border-outline">
        <div
          ref={tabBarRef}
          className={cn(
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
              onBreakOutTab={() => state.onBreakOutTab(tab)}
              onDeleteTab={() => state.onDeleteTab(tab, { preservePortal: false })}
              tabsMetaId={meta.id}
              uiStore={uiStore}
              uiStoreApi={uiStoreApi}
            />
          ))}
          <button
            ref={newTabButtonRef}
            type="button"
            className={cn(uiClassName, "cursor-pointer p-2")}
            onClick={state.onAddNewTab}
          >
            <PlusCircleIcon className="size-6" weight="duotone" />
          </button>
        </div>
        <UiInstanceMenu meta={meta} className="self-end" />
      </div>

      <div className="pt-4 px-0 flex-1 size-full overflow-auto">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            data-tab-content={tab.id}
            className={cn("size-full", tab.id !== meta.currentTabId && "hidden")}
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
  onBreakOutTab: () => void;
  onDeleteTab: () => void;
  tabsMetaId: string;
  uiStore: typeof import("@npc-cli/ui-sdk/ui.store").uiStore;
  uiStoreApi: typeof import("@npc-cli/ui-sdk/ui.store").uiStoreApi;
}

function TabHeaderItem({
  tab,
  isCurrentTab,
  onClickTab,
  onBreakOutTab,
  onDeleteTab,
  tabsMetaId,
  uiStore,
  uiStoreApi,
}: TabHeaderItemProps) {
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
            uiStore.setState((draft) => {
              const sourceMeta = draft.byId[sourceTabsMetaId]?.meta as TabsUiMeta | undefined;
              const targetMeta = draft.byId[tabsMetaId]?.meta as TabsUiMeta | undefined;
              const draggedTab = draft.byId[draggedId];

              if (!sourceMeta || !targetMeta || !draggedTab) return;

              // Don't add if already in target (prevents duplicates)
              if (targetMeta.items.includes(draggedId)) return;

              // Remove from source Tabs
              sourceMeta.items = sourceMeta.items.filter((itemId) => itemId !== draggedId);
              // Update current tab if needed
              if (sourceMeta.currentTabId === draggedId) {
                sourceMeta.currentTabId = sourceMeta.items[0];
              }

              // Add to target Tabs at the position of the drop target
              const targetIndex = targetMeta.items.indexOf(id);
              if (targetIndex !== -1) {
                targetMeta.items.splice(targetIndex, 0, draggedId);
              } else {
                targetMeta.items.push(draggedId);
              }

              // Update the tab's parentId
              draggedTab.meta.parentId = tabsMetaId;

              // Set as current tab in target Tabs
              targetMeta.currentTabId = draggedId;
            });
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
        uiClassName,
        "cursor-pointer shrink-0 px-1 border-b-2 border-outline font-medium text-sm focus:outline-none",
        !isCurrentTab && "opacity-50 hover:opacity-80",
        state.isDragging && "opacity-30",
        state.isDropTarget && "border-l-2 border-l-blue-400",
      )}
      onClick={onClickTab}
    >
      <div className={"flex items-center p-1 border border-on-background/20"}>
        <pre className="p-1">{tab.title}</pre>

        {isCurrentTab && (
          <>
            <BasicPopover
              trigger={
                <DotsThreeOutlineVerticalIcon weight="thin" className="cursor-pointer size-4 text-on-background/80" />
              }
              className="bg-black p-0 flex flex-col"
              arrowClassName="fill-black"
              side="bottom"
            >
              <div className="flex">
                <button type="button" className="px-0.5 py-1">
                  <ArrowUpRightIcon
                    weight="thin"
                    className="cursor-pointer size-5 bg-black/40 text-white"
                    onPointerDown={onBreakOutTab}
                  />
                </button>
                <button type="button" className="px-0.5 py-1">
                  <TrashIcon
                    weight="thin"
                    className="cursor-pointer size-5 bg-black/40 text-white"
                    onPointerDown={onDeleteTab}
                  />
                </button>
              </div>
              {allTabs.length > 1 && (
                <div className="border-t border-white/20 py-1">
                  {allTabs.map((targetTabs) => {
                    const isCurrent = targetTabs.id === tabsMetaId;
                    return (
                      <button
                        key={targetTabs.id}
                        type="button"
                        disabled={isCurrent}
                        className={cn(
                          "block w-full text-left text-sm px-2 py-0.5 text-white",
                          isCurrent ? "font-bold text-blue-400" : "cursor-pointer hover:bg-white/20",
                        )}
                        onPointerDown={(e) => {
                          if (isCurrent) return;
                          e.stopPropagation();
                          uiStore.setState((draft) => {
                            const sourceMeta = draft.byId[tabsMetaId]?.meta as TabsUiMeta | undefined;
                            const targetMeta = draft.byId[targetTabs.id]?.meta as TabsUiMeta | undefined;
                            const item = draft.byId[tab.id];
                            if (!sourceMeta || !targetMeta || !item) return;
                            // Remove from source
                            sourceMeta.items = sourceMeta.items.filter((id) => id !== tab.id);
                            if (sourceMeta.currentTabId === tab.id) {
                              sourceMeta.currentTabId = sourceMeta.items[0];
                            }
                            // Add to target
                            item.meta.parentId = targetTabs.id;
                            item.meta.disabled = targetMeta.disabled;
                            targetMeta.items.push(tab.id);
                            targetMeta.currentTabId = tab.id;
                          });
                        }}
                      >
                        {targetTabs.title}
                      </button>
                    );
                  })}
                </div>
              )}
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
