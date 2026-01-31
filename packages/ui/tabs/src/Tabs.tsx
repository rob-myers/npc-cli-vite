import { UiContext, uiStore } from "@npc-cli/ui-sdk";
import { cn } from "@npc-cli/util";
import { pause } from "@npc-cli/util/legacy/generic";
import { PlusCircleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useContext, useRef } from "react";
import { TabUiMetaSchema, type TabsUiMeta } from "./schema";

export default function Tabs({ meta }: {
  meta: TabsUiMeta;
}): ReactNode {
  const { layoutApi } = useContext(UiContext);
  const newTabButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className={cn("flex flex-col size-full")}>
      <div className="flex border-b border-outline">
        {meta.items.length === 0 && <div className="p-2">Empty tabs...</div>}
        {meta.items.map((tab) => (
          <button
            key={tab.id}
            className={cn(
              "cursor-pointer px-4 py-2 -mb-px border-b-2 border-outline font-medium focus:outline-none transition-colors duration-200 bg-background",
              meta.currentTabId !== tab.id && "opacity-50 hover:opacity-80",
            )}
            onClick={() => uiStore.setState(draft => {
                // 🚧 reparse tabs meta
              (draft.metaById[meta.id] as TabsUiMeta).currentTabId = tab.id;
            })}
            type="button"
          >
            {tab.title}
          </button>
        ))}
        <button
          ref={newTabButtonRef}
          type="button"
          className="cursor-pointer open-context-menu"
          onPointerUp={(e) => {
            e.stopPropagation();
            pause(30); // avoid immediate select context menu item

            layoutApi.overrideContextMenu({
              refObject: newTabButtonRef,
              addItem({ uiMeta }) {
                // 🚧 reparse tabs meta
                const parsed = TabUiMetaSchema.safeParse(uiMeta);
                if (parsed.success) {
                  uiStore.setState((draft) => {
                    const tabsMeta = draft.metaById[meta.id] as TabsUiMeta;
                    tabsMeta.items.push(parsed.data);
                    tabsMeta.currentTabId = parsed.data.id;
                  });
                } else {
                  console.error("Failed to parse tab meta", parsed.error);
                }
              },
            });
          }}
        >
          <PlusCircleIcon className="size-4" weight="duotone" />
        </button>
      </div>

      <div className="pt-4 px-2 flex-1 size-full overflow-auto">
        {meta.items.map((tab) => (
          <div
            key={tab.id}
            className={cn("size-full", tab.id !== meta.currentTabId && "hidden")}
          >
            {
              JSON.stringify({ tab }) // 🚧
            }
          </div>
        ))}
      </div>
    </div>
  );
}
