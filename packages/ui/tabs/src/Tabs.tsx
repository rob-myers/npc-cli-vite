import { UiContext, type UiInstanceMeta, uiStore, uiStoreApi } from "@npc-cli/ui-sdk";
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
  const id = meta.id;

  const byId = useStore(uiStore, (s) => s.byId);

  const state = useStateRef(
    () => ({
      onAddNewTab(e: React.PointerEvent<HTMLElement>) {
        e.stopPropagation();
        pause(30); // avoid immediate select context menu item

        layoutApi.overrideContextMenu({
          refObject: newTabButtonRef,
          addItem({ uiMeta }) {
            // 🚧 also re-parse tabsMeta
            const result = uiRegistry[uiMeta.uiKey].schema.safeParse(uiMeta);
            if (!result.success) {
              // 🚧 ui reflection
              return console.error("Failed to parse tab meta", result.error);
            } else if (result.data.uiKey === "Tabs") {
              // 🚧 ui reflection
              return console.error("Nested Tabs unsupported");
            } else {
              // portal with parentId won't be displayed in UiGrid
              result.data.parentId = id;
              uiStoreApi.addUis({ metas: [result.data] });

              uiStore.setState((draft) => {
                const tabsMeta = draft.byId[id].meta as TabsUiMeta;
                tabsMeta.items.push(result.data);
                tabsMeta.currentTabId = result.data.id;
              });
            }
          },
        });
      },
      onBreakOutTab(tab: UiInstanceMeta) {
        state.onDeleteTab(tab);

        // 🚧 append to layout too
        uiStore.setState((draft) => {
          draft.byId[tab.id]!.meta.parentId = undefined;
        });
        // layoutApi.addItem({
        //   uiMeta: tab,
        //   gridRect: layoutApi.getUiGridRect(id) ?? { x: 0, y: 0, width: 2, height: 1 },
        // });
      },
      onClickTab(tab: UiInstanceMeta) {
        // 🚧 reparse tabs meta
        uiStore.setState((draft) => {
          (draft.byId[id].meta as TabsUiMeta).currentTabId = tab.id;
        });
      },
      onDeleteTab(tab: UiInstanceMeta) {
        // 🚧 reparse tabs meta
        uiStore.setState((draft) => {
          const rootMeta = draft.byId[id].meta as TabsUiMeta;
          rootMeta.items = rootMeta.items.filter((item) => item.id !== tab.id);
          if (rootMeta.currentTabId === tab.id) {
            rootMeta.currentTabId = rootMeta.items[0]?.id;
          }
        });
      },
    }),
    { deps: [id, layoutApi, uiStore] },
  );

  return (
    <div className={cn("flex flex-col size-full overflow-auto font-mono")}>
      <div className="flex min-h-12 items-center border-b border-outline">
        {meta.items.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              "flex gap-2",
              "cursor-pointer px-1 pt-2 -mb-px border-b-2 border-outline font-medium text-sm focus:outline-none",
              meta.currentTabId !== tab.id && "opacity-50 hover:opacity-80",
            )}
            onClick={() => state.onClickTab(tab)}
          >
            <div className="flex p-1 border border-on-background/20">
              <pre className="p-1">{tab.title}</pre>

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
                      onPointerDown={() => state.onDeleteTab(tab)}
                    />
                  </button>
                </div>
              </BasicPopover>
            </div>
          </div>
        ))}
        <button
          ref={newTabButtonRef}
          type="button"
          className="cursor-pointer px-2"
          onPointerUp={state.onAddNewTab}
        >
          <PlusCircleIcon className="size-5" weight="duotone" />
        </button>
      </div>
      <div className="pt-4 px-2 flex-1 size-full overflow-auto">
        {meta.items.map((tab) => (
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
