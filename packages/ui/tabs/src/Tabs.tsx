import { UiContext } from "@npc-cli/ui-sdk";
import { cn } from "@npc-cli/util";
import { pause } from "@npc-cli/util/legacy/generic";
import { PlusCircleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { useContext, useRef, useState } from "react";
import type { TabsUiMeta } from "./schema";

export default function Tabs({ meta: { items } }: { meta: TabsUiMeta }): ReactNode {
  const { layoutApi } = useContext(UiContext);
  const [activeKey, setActiveKey] = useState(items[0]?.layoutId); // 🚧 layoutId -> id?

  const newTabButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className={cn("flex flex-col size-full")}>
      <div className="flex border-b border-outline">
        {items.length === 0 && <div className="p-2">Empty tabs...</div>}
        {items.map((tab) => (
          <button
            key={tab.layoutId}
            className={cn(
              "px-4 py-2 -mb-px border-b-2 border-outline font-medium focus:outline-none transition-colors duration-200 bg-background",
              activeKey === tab.layoutId
                ? "border-primary text-primary"
                : "border-outline text-on-background hover:text-primary/80",
            )}
            onClick={() => setActiveKey(tab.layoutId)}
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
            pause(30); // avoid immediate click context menu item

            layoutApi.overrideContextMenu({
              refObject: newTabButtonRef,
              addItem({ uiMeta, itemId, gridRect }) {
                // 🚧
                alert(`Add tab: ${JSON.stringify({ uiMeta, itemId, gridRect })}`);
              },
            });
          }}
        >
          <PlusCircleIcon className="size-4" weight="duotone" />
        </button>
      </div>
      <div className="pt-4 flex-1">
        {items.map((tab) => (
          <div
            key={tab.layoutId}
            className={cn("size-full", tab.layoutId !== activeKey && "hidden")}
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
