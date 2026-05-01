import { Allotment } from "allotment";
import type { PaneNode } from "./pane-service";
import { closePane, setSizes, splitPane } from "./pane-service";

const colors = ["bg-slate-800", "bg-slate-700", "bg-slate-900", "bg-slate-600", "bg-zinc-800", "bg-zinc-700"];

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

  return (
    <Allotment
      vertical={node.vertical}
      defaultSizes={node.sizes}
      onDragEnd={(sizes) => setSizes(node.id, sizes)}
    >
      {node.children.map((child) => (
        <Allotment.Pane key={child.id}>
          <PaneTree node={child} />
        </Allotment.Pane>
      ))}
    </Allotment>
  );
}
