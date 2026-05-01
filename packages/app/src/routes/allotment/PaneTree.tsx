import { Allotment } from "allotment";
import { uiStore } from "@npc-cli/ui-sdk/ui.store";
import * as portals from "react-reverse-portal";
import { useStore } from "zustand";
import type { PaneNode } from "./pane-service";
import { closePane, setPaneHidden, setSizes, showPane, splitPane } from "./pane-service";

const btnClass = "px-1.5 py-0.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded cursor-pointer";

function getLabel(node: PaneNode): string {
  if (node.type === "leaf") return `Pane ${node.id}`;
  return node.children.map(getLabel).join(", ");
}

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
      <div className={`absolute z-10 flex gap-1 p-1 ${posClass[edge]} ${isVertical ? "flex-row" : "flex-col"}`}>
        {children.map((child) => (
          <button key={child.id} type="button" className={btnClass} onClick={() => showPane(node.id, child.id)}>
            Show {getLabel(child)}
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
    <div className="size-full min-w-0 min-h-0 flex flex-col">
      <div className="flex gap-1 p-1 bg-background/80">
        <button type="button" className={btnClass} onClick={() => splitPane(node.id, false)}>
          Split H
        </button>
        <button type="button" className={btnClass} onClick={() => splitPane(node.id, true)}>
          Split V
        </button>
        <button
          type="button"
          className="px-1.5 py-0.5 text-xs bg-slate-600 hover:bg-red-700 text-slate-300 rounded cursor-pointer"
          onClick={() => closePane(node.id)}
        >
          ✕
        </button>
      </div>
      <div className="flex-1 min-h-0 relative overflow-hidden bg-white text-black">
        {portal && <portals.OutPortal node={portal.portalNode} />}
      </div>
    </div>
  );
}
