import type { WorldState } from "@npc-cli/ui__world";
import { cn } from "@npc-cli/util";
import { CrosshairIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { typeIcon } from "./decor-edit";

/** The map's runtime decor: select here or on the map alike; double-click renames */
export function DecorSidebar({ w, selected, onSelect, onRename, onShowIn3d }: Props) {
  const [filter, setFilter] = useState("");
  const decors = Object.values(w.decor.runtime.byKey)
    .filter((d) => filter === "" || `${d.key} ${d.type} ${d.meta.grKey ?? ""}`.includes(filter))
    .sort((a, b) => a.key.localeCompare(b.key));

  return (
    <div className="flex-1 min-w-0 flex flex-col border-r border-slate-800">
      <input
        className="m-1 px-2 py-0.5 rounded border border-slate-800 bg-slate-950 outline-none focus:border-slate-600"
        placeholder="filter by key, type, room"
        value={filter}
        onChange={(e) => setFilter(e.currentTarget.value)}
      />
      <div className="flex-1 overflow-y-auto scrollbar-thin select-none">
        {decors.length === 0 && <div className="px-2 py-2 text-slate-600">no decor</div>}
        {decors.map((d) => {
          const TypeIcon = typeIcon[d.type];
          const isSelected = selected.includes(d.key);
          return (
            <div
              key={d.key}
              className={cn(
                "group flex items-center gap-1.5 pl-2 pr-1 py-0.5 cursor-pointer hover:bg-slate-800/60",
                isSelected && "bg-slate-800",
              )}
              onClick={(e) =>
                onSelect(
                  e.shiftKey ? (isSelected ? selected.filter((k) => k !== d.key) : [...selected, d.key]) : [d.key],
                )
              }
            >
              <TypeIcon className="size-3.5 shrink-0 text-slate-500" />
              <Name value={d.key} onCommit={(next) => onRename(d.key, next)} />
              <span className="ml-auto text-[10px] text-slate-600">{String(d.meta.grKey ?? "")}</span>
              <button
                type="button"
                title="show in 3D"
                className="grid place-items-center size-5 rounded text-slate-500 opacity-0 group-hover:opacity-100 hover:bg-slate-700 hover:text-slate-200 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  onShowIn3d(d.key);
                }}
              >
                <CrosshairIcon className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
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
      className="min-w-0 flex-1 bg-slate-950 border border-slate-600 rounded px-1 outline-none select-text"
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
