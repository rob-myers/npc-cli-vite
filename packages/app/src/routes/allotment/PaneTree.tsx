import { Allotment } from "allotment";
import type { PaneNode } from "./pane-service";
import { closePane, setPaneHidden, setSizes, showPane, splitPane } from "./pane-service";

const colors = ["bg-slate-800", "bg-slate-700", "bg-slate-900", "bg-slate-600", "bg-zinc-800", "bg-zinc-700"];

const btnClass = "px-1.5 py-0.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded cursor-pointer";

function getLabel(node: PaneNode): string {
  if (node.type === "leaf") return `Pane ${node.id}`;
  return node.children.map(getLabel).join(", ");
}

export function PaneTree({ node }: { node: PaneNode }) {
  if (node.type === "leaf") {
    return (
      <div className={`size-full flex flex-col ${colors[node.id % colors.length]}`}>
        <div className="flex gap-1 p-1">
          <button
            type="button"
            className="px-1.5 py-0.5 text-xs bg-slate-600 hover:bg-slate-500 text-slate-300 rounded cursor-pointer"
            onClick={() => splitPane(node.id, false)}
          >
            Split H
          </button>
          <button
            type="button"
            className="px-1.5 py-0.5 text-xs bg-slate-600 hover:bg-slate-500 text-slate-300 rounded cursor-pointer"
            onClick={() => splitPane(node.id, true)}
          >
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
        <div className="flex-1 flex items-center justify-center text-slate-400">
          Pane {node.id}
        </div>
      </div>
    );
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
