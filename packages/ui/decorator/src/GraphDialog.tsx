import { Dialog } from "@base-ui/react/dialog";
import type { GraphEntry } from "@npc-cli/ui__world/scenario.schema";
import { cn } from "@npc-cli/util";
import { XIcon } from "@phosphor-icons/react";
import { Fragment } from "react";
import { GraphShape } from "./GraphShape";

/** A graph as saved, read-only, e.g. one on another map. Kept inside the panel's root `container` */
export function GraphDialog({
  graph,
  container,
  onClose,
}: {
  graph: null | GraphEntry;
  container: null | HTMLElement;
  onClose(): void;
}) {
  return (
    <Dialog.Root open={graph !== null} onOpenChange={(open) => open === false && onClose()}>
      <Dialog.Portal container={container}>
        <Dialog.Backdrop className="absolute inset-0 z-50 bg-black/60" />
        <Dialog.Popup
          className={cn(
            "absolute left-1/2 top-[5%] z-50 -translate-x-1/2 w-[90%] max-w-md max-h-[90%] overflow-y-auto",
            "rounded-lg border border-zinc-700 bg-zinc-900 text-xs text-zinc-300 shadow-2xl outline-none",
          )}
          // the panel's keys are not for the dialog. Base UI closes it on Escape from the document
          onKeyDown={(e) => e.stopPropagation()}
        >
          {graph !== null && <GraphCard graph={graph} />}
          <Dialog.Close className="absolute top-2 right-2 p-1 rounded cursor-pointer text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100">
            <XIcon className="size-4" />
          </Dialog.Close>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function GraphCard({ graph }: { graph: GraphEntry }) {
  const meta = (value: Record<string, unknown>) => (Object.keys(value).length === 0 ? "" : JSON.stringify(value));
  const rows: [string, string][] = [
    ["map", graph.mapKey],
    ["edges", graph.directed ? "directed" : "undirected"],
    ["meta", meta(graph.meta) || "none"],
  ];
  return (
    <div className="p-3 flex flex-col gap-2">
      <Dialog.Title className="pr-6 text-zinc-100">{graph.name || graph.key}</Dialog.Title>
      <div className="text-zinc-500">{graph.key}</div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3">
        {rows.map(([label, value]) => (
          <Fragment key={label}>
            <span className="text-zinc-500">{label}</span>
            <span className="break-all">{value}</span>
          </Fragment>
        ))}
      </div>
      <GraphShape graph={graph} />
      <div className="text-zinc-500">nodes</div>
      <div className="grid grid-cols-[auto_auto_1fr] gap-x-3 font-mono">
        {graph.nodes.map((n) => (
          <Fragment key={n.id}>
            <span>{n.id}</span>
            <span>{n.spot ?? `${n.at[0]}, ${n.at[1]}`}</span>
            <span className="break-all text-zinc-500">{meta(n.meta)}</span>
          </Fragment>
        ))}
      </div>
      <div className="text-zinc-500">edges</div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 font-mono">
        {graph.edges.map((e, i) => (
          <Fragment key={i}>
            <span>
              {e.from} {graph.directed ? "→" : "—"} {e.to}
            </span>
            <span className="break-all text-zinc-500">{meta(e.meta)}</span>
          </Fragment>
        ))}
      </div>
      <div className="text-zinc-500">
        Edit it in this tab on its own map. <code>act patrol {graph.key.slice("graph/".length)}</code> walks it.
      </div>
    </div>
  );
}
