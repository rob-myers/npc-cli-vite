import { cn } from "@npc-cli/util";
import type { ReactNode } from "react";
import { useState } from "react";
import type { TabsUiMeta } from "./schema";

export default function Tabs({ meta: { items } }: { meta: TabsUiMeta }): ReactNode {
  const [activeKey, setActiveKey] = useState(items[0]?.layoutId); // 🚧 layoutId -> id?

  return (
    <div className={cn("flex flex-col size-full")}>
      <div className="flex border-b border-outline">
        {items.length === 0 && <div className="p-2">Empty tabs...</div>}
        {items.map((tab) => (
          <button
            key={tab.layoutId}
            className={cn(
              "px-4 py-2 -mb-px border-b-2 border-outline font-medium focus:outline-none transition-colors duration-200 bg-surface",
              activeKey === tab.layoutId
                ? "border-primary text-primary"
                : "border-outline text-on-surface hover:text-primary/80",
            )}
            onClick={() => setActiveKey(tab.layoutId)}
            type="button"
          >
            {tab.title}
          </button>
        ))}
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
