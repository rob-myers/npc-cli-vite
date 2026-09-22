import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
  attachClosestEdge,
  type Edge,
  extractClosestEdge,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import type { WorldState } from "@npc-cli/ui__world";
import { cn } from "@npc-cli/util";
import { CrosshairIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { typeIcon } from "./decor-edit";
import { getDecoratorMapStore } from "./storage";

/**
 * The map's runtime decor: select here or on the map alike — cmd-click toggles one, shift-click
 * takes the run from the last plain click; double-click renames; drag to arrange, as `MapEdit`'s
 * inspector does, the arrangement kept per World and map
 */
export function DecorSidebar({ w, selected, onSelect, onRename, onShowIn3d }: Props) {
  const [filter, setFilter] = useState("");
  const anchor = useRef<string | null>(null);
  const store = getDecoratorMapStore(w.key, w.mapKey);
  const [order, setOrder] = useState(() => store.read().order);

  const rank = new Map(order.map((key, i) => [key, i]));
  const all = Object.values(w.decor.runtime.byKey).sort(
    (a, b) => (rank.get(a.key) ?? Infinity) - (rank.get(b.key) ?? Infinity) || a.key.localeCompare(b.key),
  );
  const decors = all.filter((d) => filter === "" || `${d.key} ${d.type} ${d.meta.grKey ?? ""}`.includes(filter));

  function onClickRow(e: React.MouseEvent, key: string) {
    if (e.metaKey || e.ctrlKey) {
      anchor.current = key;
      return onSelect(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
    }
    const from = decors.findIndex((d) => d.key === anchor.current);
    if (e.shiftKey && from !== -1) {
      const to = decors.findIndex((d) => d.key === key);
      const run = decors.slice(Math.min(from, to), Math.max(from, to) + 1).map((d) => d.key);
      return onSelect([...new Set([...selected, ...run])]);
    }
    anchor.current = key;
    onSelect([key]);
  }

  /** Put `keys` beside `target`, in the whole list's order, and keep it */
  function onReorder(keys: string[], target: string, edge: Edge) {
    const rest = all.map((d) => d.key).filter((key) => !keys.includes(key));
    const at = rest.indexOf(target) + (edge === "bottom" ? 1 : 0);
    const next = [...rest.slice(0, at), ...keys, ...rest.slice(at)];
    store.patch({ order: next });
    setOrder(next);
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col border-r border-zinc-800">
      <input
        className="m-1 px-2 py-0.5 rounded border border-zinc-800 bg-zinc-950 outline-none focus:border-zinc-600"
        placeholder="filter by key, type, room"
        value={filter}
        onChange={(e) => setFilter(e.currentTarget.value)}
      />
      <div className="flex-1 overflow-y-auto scrollbar-thin select-none">
        {decors.length === 0 && <div className="px-2 py-2 text-zinc-600">no decor</div>}
        {decors.map((d) => (
          <Row
            key={d.key}
            decor={d}
            isSelected={selected.includes(d.key)}
            // dragging a selected row brings the selection
            dragKeys={selected.includes(d.key) ? selected : [d.key]}
            onClick={(e) => onClickRow(e, d.key)}
            onRename={(next) => onRename(d.key, next)}
            onShowIn3d={() => onShowIn3d(d.key)}
            onDrop={(keys, edge) => onReorder(keys, d.key, edge)}
          />
        ))}
      </div>
    </div>
  );
}

/** A row: draggable, and a drop target above or below */
function Row({ decor: d, isSelected, dragKeys, onClick, onRename, onShowIn3d, onDrop }: RowProps) {
  const el = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState<Edge | null>(null);
  const latest = useRef({ dragKeys, onDrop });
  latest.current = { dragKeys, onDrop };
  const TypeIcon = typeIcon[d.type];

  useEffect(() => {
    if (el.current === null) return;
    const element = el.current;
    return combine(
      draggable({
        element,
        getInitialData: () => ({ type: dragType, key: d.key, keys: latest.current.dragKeys }),
      }),
      dropTargetForElements({
        element,
        canDrop: ({ source }) => source.data.type === dragType && source.data.key !== d.key,
        getData: ({ input }) => attachClosestEdge({}, { element, input, allowedEdges: ["top", "bottom"] }),
        onDrag: ({ self }) => setEdge(extractClosestEdge(self.data)),
        onDragLeave: () => setEdge(null),
        onDrop: ({ self, source }) => {
          setEdge(null);
          const edge = extractClosestEdge(self.data);
          if (edge !== null) latest.current.onDrop(source.data.keys as string[], edge);
        },
      }),
    );
  }, [d.key]);

  return (
    <div
      ref={el}
      className={cn(
        "group flex items-center gap-1.5 pl-2 pr-1 py-0.5 cursor-pointer hover:bg-zinc-800/60 border-y border-transparent",
        isSelected && "bg-zinc-800",
        edge === "top" && "border-t-amber-300",
        edge === "bottom" && "border-b-amber-300",
      )}
      onClick={onClick}
    >
      <TypeIcon className="size-3.5 shrink-0 text-zinc-500" />
      <Name value={d.key} onCommit={onRename} />
      <span className="ml-auto text-[10px] text-zinc-600">{String(d.meta.grKey ?? "")}</span>
      <button
        type="button"
        title="show in 3D"
        className="grid place-items-center size-5 rounded text-zinc-500 opacity-0 group-hover:opacity-100 hover:bg-zinc-700 hover:text-zinc-200 cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          onShowIn3d();
        }}
      >
        <CrosshairIcon className="size-3.5" />
      </button>
    </div>
  );
}

/** Double-click to rename; Enter or blur commits, Escape gives up */
function Name({ value, onCommit }: { value: string; onCommit(next: string): void }) {
  const [editing, setEditing] = useState(false);
  if (editing === false) {
    return (
      <span className="truncate" title="double-click to rename" onDoubleClick={() => setEditing(true)}>
        {value}
      </span>
    );
  }
  return (
    <input
      autoFocus
      defaultValue={value}
      className="min-w-0 flex-1 bg-zinc-950 border border-zinc-600 rounded px-1 outline-none select-text"
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        setEditing(false);
        onCommit(e.currentTarget.value.trim());
      }}
      onKeyDown={(e) => {
        e.stopPropagation(); // not the panel's shortcuts
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}

type Props = {
  w: WorldState;
  selected: string[];
  onSelect(keys: string[]): void;
  onRename(key: string, next: string): void;
  onShowIn3d(key: string): void;
};

type RowProps = {
  decor: Geomorph.Decor;
  isSelected: boolean;
  dragKeys: string[];
  onClick(e: React.MouseEvent): void;
  onRename(next: string): void;
  onShowIn3d(): void;
  onDrop(keys: string[], edge: Edge): void;
};

const dragType = "decor-row";
