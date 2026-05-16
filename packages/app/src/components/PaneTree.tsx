import { uiStore } from "@npc-cli/ui-sdk/ui.store";
import { cn } from "@npc-cli/util";
import { BookOpenTextIcon } from "@phosphor-icons/react";
import { Allotment } from "allotment";
import * as portals from "react-reverse-portal";
import { useStore } from "zustand";
import type { PaneNode } from "./pane-service";
import { setPaneHidden, setSizes, showPane } from "./pane-service";

const btnClass = "px-1.5 py-0.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded cursor-pointer";

export function PaneTree({ node }: { node: PaneNode }) {
  if (node.type === "leaf") {
    return <PaneLeaf node={node} />;
  }

  const hiddenSet = new Set(node.hiddenIds);
  const lastIndex = node.children.length - 1;
  const startHidden = node.children.filter((c, i) => hiddenSet.has(c.id) && i <= lastIndex / 2);
  const endHidden = node.children.filter((c, i) => hiddenSet.has(c.id) && i > lastIndex / 2);

  const isVertical = node.vertical;

  const posClass = {
    start: isVertical ? "top-0 left-1/2 -translate-x-1/2" : "left-0 top-1/2 -translate-y-1/2",
    end: isVertical ? "bottom-0 left-1/2 -translate-x-1/2" : "right-0 top-1/2 -translate-y-1/2",
  };

  const edgeBar = (children: PaneNode[], edge: "start" | "end") => {
    if (children.length === 0) return null;
    return (
      <div className={`absolute z-10 gap-1 *:p-1 ${posClass[edge]}`}>
        {children.map((child) => (
          <button
            key={child.id}
            type="button"
            className={cn(
              btnClass,
              "text-on-background/50 bg-background/50 hover:bg-background hover:text-on-background",
            )}
            onClick={() => showPane(node.id, child.id)}
          >
            <BookOpenTextIcon className="size-5" />
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="size-full relative">
      {edgeBar(startHidden, "start")}
      {edgeBar(endHidden, "end")}
      <Allotment
        key={`${node.id}-${isVertical}`}
        vertical={isVertical}
        defaultSizes={node.sizes}
        snap
        onDragEnd={(sizes) => setSizes(node.id, sizes)}
        onVisibleChange={(index, visible) => setPaneHidden(node.id, index, visible)}
      >
        {node.children.map((child) => (
          <Allotment.Pane key={child.id} visible={!hiddenSet.has(child.id)} snap minSize={90}>
            <PaneTree node={child} />
          </Allotment.Pane>
        ))}
      </Allotment>
    </div>
  );
}

function PaneLeaf({ node }: { node: Extract<PaneNode, { type: "leaf" }> }) {
  const portal = useStore(uiStore, (s) => (node.uiId ? s.byId[node.uiId]?.portal : undefined));

  return (
    <div className="size-full min-w-0 min-h-0 relative overflow-hidden bg-background text-on-background">
      {portal && <portals.OutPortal node={portal.portalNode} />}
    </div>
  );
}
