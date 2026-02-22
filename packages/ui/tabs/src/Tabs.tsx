import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
  UiContext,
  UiInstanceMenu,
  type UiInstanceMeta,
  uiClassName,
  uiStore,
  uiStoreApi,
} from "@npc-cli/ui-sdk";
import { BasicPopover, cn, useStateRef } from "@npc-cli/util";
import { pause } from "@npc-cli/util/legacy/generic";
import {
  ArrowUpRightIcon,
  DotsThreeOutlineVerticalIcon,
  PlusCircleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useContext, useEffect, useRef } from "react";
import * as portals from "react-reverse-portal";
import { useStore } from "zustand";
import type { TabsUiMeta } from "./schema";

export default function Tabs({ meta }: { meta: TabsUiMeta }): React.ReactNode {
  const { layoutApi, uiRegistry } = useContext(UiContext);
  const newTabButtonRef = useRef<HTMLButtonElement>(null);

  const byId = useStore(uiStore, (s) => s.byId);

  const state = useStateRef(
    () => ({
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
        layoutApi.appendLayoutItems([
          { i: tab.id, x: 0, y: 0, w: 2, h: 1, ...layoutApi.getUiGridRect(meta.id) },
        ]);
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

  const tabs = meta.items.map((itemId) => byId[itemId]?.meta).filter(Boolean);

  return (
    <div className="flex flex-col size-full overflow-auto font-mono">
      <div className="flex justify-between min-h-12 w-full border-b border-outline">
        <div className="flex items-end overflow-auto [scrollbar-width:thin]">
          {tabs.map((tab) => (
            <TabItem
              key={tab.id}
              tab={tab}
              isCurrentTab={meta.currentTabId === tab.id}
              onClickTab={() => state.onClickTab(tab)}
              onBreakOutTab={() => state.onBreakOutTab(tab)}
              onDeleteTab={() => state.onDeleteTab(tab, { preservePortal: false })}
              tabsMetaId={meta.id}
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
        <UiInstanceMenu meta={meta} />
      </div>
      <div className="pt-4 px-2 flex-1 size-full overflow-auto">
        {tabs.map((tab) => (
          <div key={tab.id} className={cn("size-full", tab.id !== meta.currentTabId && "hidden")}>
            {byId[tab.id] && (
              <portals.OutPortal key={tab.id} node={byId[tab.id].portal.portalNode} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

interface TabItemProps {
  tab: UiInstanceMeta;
  isCurrentTab: boolean;
  onClickTab: () => void;
  onBreakOutTab: () => void;
  onDeleteTab: () => void;
  tabsMetaId: string;
}

function TabItem({
  tab,
  isCurrentTab,
  onClickTab,
  onBreakOutTab,
  onDeleteTab,
  tabsMetaId,
}: TabItemProps) {
  const state = useStateRef(() => ({
    tabEl: null as HTMLDivElement | null,
    isDragging: false,
    isDropTarget: false,
  }));

  useEffect(() => {
    const el = state.tabEl;
    if (!el) return;
    const id = tab.id;

    return combine(
      draggable({
        element: el,
        getInitialData: () => ({ type: "tab", id, tabsMetaId }),
        onDragStart: () => state.set({ isDragging: true }),
        onDrop: () => state.set({ isDragging: false }),
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) =>
          source.data.type === "tab" &&
          source.data.tabsMetaId === tabsMetaId &&
          source.data.id !== id,
        onDragEnter: () => state.set({ isDropTarget: true }),
        onDragLeave: () => state.set({ isDropTarget: false }),
        onDrop: ({ source }) => {
          state.set({ isDropTarget: false });
          const draggedId = source.data.id as string;
          if (draggedId === id) return;

          uiStoreApi.setUiMeta(tabsMetaId, (draft) => {
            if (!draft.items) return;
            const draggedIndex = draft.items.indexOf(draggedId);
            const targetIndex = draft.items.indexOf(id);
            // Remove dragged item
            draft.items.splice(draggedIndex, 1);
            // Insert at target position
            draft.items.splice(targetIndex, 0, draggedId);
          });
        },
      }),
    );
  }, [tab.id, tabsMetaId]);

  return (
    <div
      ref={state.ref("tabEl")}
      className={cn(
        uiClassName,
        "cursor-pointer px-1 border-b-2 border-outline font-medium text-sm focus:outline-none",
        !isCurrentTab && "opacity-50 hover:opacity-80",
        state.isDragging && "opacity-30",
        state.isDropTarget && "border-l-2 border-l-blue-400",
      )}
      onClick={onClickTab}
    >
      <div className={"flex p-1 border border-on-background/20"}>
        <pre className="p-1">{tab.title}</pre>

        {isCurrentTab && (
          <BasicPopover
            trigger={
              <DotsThreeOutlineVerticalIcon
                weight="thin"
                className="cursor-pointer size-4 text-on-background/80"
              />
            }
            className="bg-black p-0"
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
          </BasicPopover>
        )}
      </div>
    </div>
  );
}
