import type { GraphEntry } from "@npc-cli/ui__world/scenario.schema";
import { cn } from "@npc-cli/util";
import { PlusIcon, TrashIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { type GraphTarget, metaOf, withMeta } from "./graph-edit";

/**
 * The graph tab: this map's graphs, then the chosen one's meta, or its selected node's or edge's.
 * In DEV a graph can be made, deleted, renamed and its meta edited — see `docs/npc-graphs.md`
 */
export function GraphSidebar({
  graphs,
  chosen,
  target,
  editable,
  error,
  onChoose,
  onNew,
  onDelete,
  onCommit,
  onTarget,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => setConfirming(false), [chosen?.key]);
  const meta = chosen === null ? undefined : metaOf(chosen, target);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto border-r border-zinc-800 py-1 text-xs">
      {Object.values(graphs).map((x) => (
        <button
          key={x.key}
          type="button"
          className={cn(
            "w-full flex items-center gap-2 px-2 py-0.5 text-left cursor-pointer hover:bg-zinc-800",
            x.key === chosen?.key ? "bg-zinc-800 text-zinc-100" : "text-zinc-400",
          )}
          onClick={() => onChoose(x.key)}
        >
          <span className="truncate">{x.name || x.key}</span>
          <span className="ml-auto shrink-0 text-zinc-500">
            {x.nodes.length} · {x.edges.length}
            {x.directed ? " ⇢" : ""}
          </span>
        </button>
      ))}
      {Object.keys(graphs).length === 0 && <div className="px-2 py-1 text-zinc-600">no graphs on this map</div>}
      {editable ? (
        <button
          type="button"
          className="flex items-center gap-1 px-2 py-0.5 text-zinc-500 hover:text-zinc-200 cursor-pointer"
          onClick={onNew}
        >
          <PlusIcon className="size-3" /> new graph
        </button>
      ) : (
        <div className="px-2 py-1 text-zinc-600">read-only outside DEV</div>
      )}
      {error !== null && <div className="px-2 py-1 text-red-300">{error}</div>}

      {chosen !== null && meta !== undefined && (
        <div className="mt-2 flex flex-col gap-1 border-t border-zinc-800 px-2 pt-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              title="select the graph itself"
              className={cn("cursor-pointer", target === null ? "text-zinc-100" : "text-zinc-500 hover:text-zinc-300")}
              onClick={() => onTarget(null)}
            >
              {chosen.key}
            </button>
            {editable && (
              <button
                type="button"
                title={confirming ? "click again to delete it" : "delete this graph"}
                className={cn(
                  "ml-auto flex items-center gap-1 rounded px-1 cursor-pointer",
                  confirming ? "bg-red-900 text-red-100" : "text-zinc-500 hover:text-red-300",
                )}
                onClick={() => (confirming ? onDelete(chosen.key) : setConfirming(true))}
              >
                <TrashIcon className="size-3.5" />
                {confirming && "delete?"}
              </button>
            )}
          </div>
          {target === null && (
            <TextField
              label="name"
              value={chosen.name}
              readOnly={!editable}
              onCommit={(name) => onCommit({ ...chosen, name })}
            />
          )}
          <div className="text-zinc-500">{describe(chosen, target)} meta</div>
          <MetaField
            key={`${chosen.key} ${JSON.stringify(target)}`}
            value={meta}
            readOnly={!editable}
            onCommit={(next) => onCommit(withMeta(chosen, target, next))}
          />
          <div className="text-zinc-600">ctrl+enter or blur saves. Node meta e.g. {'{ "secs": 4 }'}</div>
        </div>
      )}
    </div>
  );
}

/** JSON for an object, saved on blur or ctrl+enter, red whilst it does not parse as one */
function MetaField({
  value,
  readOnly,
  onCommit,
}: {
  value: Record<string, unknown>;
  readOnly: boolean;
  onCommit(meta: Record<string, unknown>): void;
}) {
  const shown = JSON.stringify(value, null, 2);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const parsed = parseObject(text);
  const commit = () => parsed !== null && JSON.stringify(parsed, null, 2) !== shown && onCommit(parsed);
  return (
    <textarea
      value={text}
      readOnly={readOnly}
      spellCheck={false}
      rows={Math.min(12, Math.max(3, text.split("\n").length))}
      className={cn(
        "w-full resize-y rounded border bg-zinc-950 px-1 py-0.5 font-mono text-zinc-200 outline-none",
        parsed === null ? "border-red-500" : "border-zinc-700",
      )}
      onChange={(e) => setText(e.currentTarget.value)}
      onBlur={commit}
      // the panel's keys, e.g. Backspace deletes decor, are not for a field
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
      }}
    />
  );
}

/** Saved on Enter or blur */
function TextField(props: { label: string; value: string; readOnly: boolean; onCommit(value: string): void }) {
  const [text, setText] = useState(props.value);
  useEffect(() => setText(props.value), [props.value]);
  const commit = () => text !== props.value && props.onCommit(text);
  return (
    <label className="flex items-center gap-2 text-zinc-500">
      {props.label}
      <input
        value={text}
        readOnly={props.readOnly}
        className="flex-1 min-w-0 rounded border border-zinc-700 bg-zinc-950 px-1 py-0.5 text-zinc-200 outline-none"
        onChange={(e) => setText(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") commit();
        }}
      />
    </label>
  );
}

/** e.g. `node n3 on g0r2-1`, `edge n1 → n2` */
function describe(graph: GraphEntry, target: GraphTarget) {
  if (target === null) return "graph";
  if ("node" in target) {
    const spot = graph.nodes.find((n) => n.id === target.node)?.spot;
    return `node ${target.node}${spot === undefined ? "" : ` on ${spot}`}`;
  }
  const edge = graph.edges[target.edge];
  return edge === undefined ? "edge" : `edge ${edge.from} ${graph.directed ? "→" : "—"} ${edge.to}`;
}

function parseObject(text: string): null | Record<string, unknown> {
  try {
    const value = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

type Props = {
  graphs: Record<string, GraphEntry>;
  /** As edited */
  chosen: null | GraphEntry;
  target: GraphTarget;
  editable: boolean;
  error: null | string;
  onChoose(key: string): void;
  onNew(): void;
  onDelete(key: string): void;
  onCommit(next: GraphEntry): void;
  onTarget(target: GraphTarget): void;
};
