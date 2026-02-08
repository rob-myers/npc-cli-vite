import { UiContext, type UiInstanceMeta, uiClassName, uiStore, uiStoreApi } from "@npc-cli/ui-sdk";
import { BasicPopover, cn, useStateRef } from "@npc-cli/util";
import { pause } from "@npc-cli/util/legacy/generic";
import {
  ArrowUpRightIcon,
  DotsThreeOutlineVerticalIcon,
  PlusCircleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useContext, useRef } from "react";
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
            rootMeta.currentTabId = rootMeta.items[prevIndex - 1];
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
    <div className={cn("flex flex-col size-full overflow-auto font-mono")}>
      <div className={cn("flex min-h-12 items-end border-b border-outline")}>
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              uiClassName,
              "cursor-pointer px-1 border-b-2 border-outline font-medium text-sm focus:outline-none",
              meta.currentTabId !== tab.id && "opacity-50 hover:opacity-80",
            )}
            onClick={() => state.onClickTab(tab)}
          >
            <div className={"flex p-1 border border-on-background/20"}>
              <pre className="p-1">{tab.title}</pre>

              {tab.id === meta.currentTabId && (
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
                        onPointerDown={() => state.onBreakOutTab(tab)}
                      />
                    </button>
                    <button type="button" className="px-0.5 py-1">
                      <TrashIcon
                        weight="thin"
                        className="cursor-pointer size-5 bg-black/40 text-white"
                        onPointerDown={() => state.onDeleteTab(tab, { preservePortal: false })}
                      />
                    </button>
                  </div>
                </BasicPopover>
              )}
            </div>
          </div>
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
