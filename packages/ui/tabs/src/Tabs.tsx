import { UiContext, UiInstance, uiStore } from "@npc-cli/ui-sdk";
import { BasicPopover, cn } from "@npc-cli/util";
import { pause } from "@npc-cli/util/legacy/generic";
import {
  ArrowUpRightIcon,
  DotsThreeOutlineVerticalIcon,
  PlusCircleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useContext, useRef } from "react";
import type { TabsUiMeta } from "./schema";

export default function Tabs({ meta }: { meta: TabsUiMeta }): ReactNode {
  const { layoutApi, uiRegistry } = useContext(UiContext);
  const newTabButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className={cn("flex flex-col size-full overflow-auto")}>
      <div className="flex items-center border-b border-outline">
        {meta.items.length === 0 && <div className="p-2 italic">no tabs</div>}
        {meta.items.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={cn(
              "flex gap-2",
              "cursor-pointer px-1 pt-2 -mb-px border-b-2 border-outline font-medium text-sm focus:outline-none",
              meta.currentTabId !== tab.id && "opacity-50 hover:opacity-80",
            )}
            onClick={() =>
              // 🚧 reparse tabs meta
              uiStore.setState((draft) => {
                (draft.metaById[meta.id] as TabsUiMeta).currentTabId = tab.id;
              })
            }
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
                className="bg-gray-600/70 p-1 pt-2"
                arrowClassName="fill-gray-600/70"
                side="bottom"
              >
                <div className="flex gap-2">
                  <button type="button">
                    <ArrowUpRightIcon
                      weight="thin"
                      className="cursor-pointer size-5 bg-black/40 text-white"
                    />
                  </button>

                  <button type="button">
                    <TrashIcon
                      weight="thin"
                      className="cursor-pointer size-5 bg-black/40 text-white"
                    />
                  </button>
                </div>
              </BasicPopover>
            </div>
          </button>
        ))}
        <button
          ref={newTabButtonRef}
          type="button"
          className="cursor-pointer pl-2 pt-2"
          onPointerUp={(e) => {
            e.stopPropagation();
            pause(30); // avoid immediate select context menu item

            layoutApi.overrideContextMenu({
              refObject: newTabButtonRef,
              addItem({ uiMeta }) {
                // 🚧 also re-parse tabsMeta
                const parsed = uiRegistry[uiMeta.uiKey].schema.safeParse(uiMeta);
                if (!parsed.success) {
                  // 🚧 ui reflection
                  return console.error("Failed to parse tab meta", parsed.error);
                } else if (parsed.data.uiKey === "Tabs") {
                  // 🚧 ui reflection
                  return console.error("Nested Tabs unsupported");
                } else {
                  uiStore.setState((draft) => {
                    const tabsMeta = draft.metaById[meta.id] as TabsUiMeta;
                    tabsMeta.items.push(parsed.data);
                    tabsMeta.currentTabId = parsed.data.id;
                  });
                }
              },
            });
          }}
        >
          <PlusCircleIcon className="size-5" weight="duotone" />
        </button>
      </div>

      <div className="pt-4 px-2 flex-1 size-full overflow-auto">
        {meta.items.map((tab) => (
          <div key={tab.id} className={cn("size-full", tab.id !== meta.currentTabId && "hidden")}>
            <UiInstance meta={tab} uiRegistry={uiRegistry} />
          </div>
        ))}
      </div>
    </div>
  );
}
