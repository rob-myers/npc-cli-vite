import { type Route, routes } from "@npc-cli/cli/jsh/world/route";
import type { WorldState } from "@npc-cli/ui__world";
import { cn } from "@npc-cli/util";
import {
  CopyIcon,
  EyeIcon,
  EyeSlashIcon,
  type Icon,
  LockIcon,
  LockOpenIcon,
  PlusIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { trackId } from "./schema";

/**
 * The routes of the map and their tracks. Every change is one `routes.set` or `routes.remove`, so
 * the shell and the World see it as they would a `route_add`
 */
export function RoutesSidebar({ w, all, selected, hidden, locked, onSelect, onToggle }: Props) {
  function renameRoute(name: string, next: string) {
    if (next === "" || next === name || next in all) return;
    const def = all[name];
    routes.remove(w, name);
    routes.set(w, next, def);
  }

  function renameTrack(name: string, role: string, next: string) {
    const def = all[name];
    if (next === "" || next === role || next in def.tracks) return;
    // rebuilt in order: a track's colour is its place in the route
    def.tracks = Object.fromEntries(Object.entries(def.tracks).map(([k, steps]) => [k === role ? next : k, steps]));
    routes.set(w, name, def);
    if (selected === trackId(name, role)) onSelect(trackId(name, next));
  }

  return (
    <div className="w-52 shrink-0 flex flex-col border-r border-slate-800 overflow-y-auto scrollbar-thin">
      <div className="flex items-center justify-between pl-2 pr-1 py-1 text-slate-500 border-b border-slate-800">
        <span>routes</span>
        <IconButton
          icon={PlusIcon}
          title="new route"
          onClick={() => {
            const name = firstFree((i) => `route-${i}`, all);
            routes.set(w, name, { tracks: { a: [] } });
            onSelect(trackId(name, "a"));
          }}
        />
      </div>

      {Object.keys(all).length === 0 && <div className="px-2 py-2 text-slate-600">none on this map</div>}

      {Object.entries(all).map(([name, def]) => (
        <div key={name} className="border-b border-slate-900">
          <div className="group flex items-center gap-1 pl-2 pr-1 py-0.5 bg-slate-900/60">
            <EditableName value={name} onCommit={(next) => renameRoute(name, next)} className="text-slate-200" />
            {def.loop !== undefined && <span className="text-[10px] text-slate-500">{def.loop}</span>}
            <span className="ml-auto flex opacity-0 group-hover:opacity-100">
              <IconButton
                icon={PlusIcon}
                title="new track"
                onClick={() => {
                  const role = firstFree((i) => String.fromCharCode(96 + i), def.tracks);
                  def.tracks[role] = [];
                  routes.set(w, name, def);
                  onSelect(trackId(name, role));
                }}
              />
              <IconButton
                icon={CopyIcon}
                title="duplicate"
                onClick={() =>
                  routes.set(
                    w,
                    firstFree((i) => `${name}-${i}`, all),
                    structuredClone(def),
                  )
                }
              />
              <IconButton icon={TrashIcon} title="delete route" danger onClick={() => routes.remove(w, name)} />
            </span>
          </div>

          {Object.entries(def.tracks).map(([role, steps], trackIndex) => {
            const id = trackId(name, role);
            const isHidden = hidden.includes(id);
            const isLocked = locked.includes(id);
            return (
              <div
                key={role}
                className={cn(
                  "group flex items-center gap-1.5 pl-4 pr-1 py-0.5 cursor-pointer hover:bg-slate-800/60",
                  id === selected && "bg-slate-800",
                  isHidden && "opacity-50",
                )}
                onClick={() => onSelect(id === selected ? null : id)}
              >
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: routes.colorOf(trackIndex) }} />
                <EditableName value={role} onCommit={(next) => renameTrack(name, role, next)} />
                <span className="text-[10px] text-slate-600">{steps.length}</span>
                <span className="ml-auto flex">
                  <IconButton
                    icon={isHidden ? EyeSlashIcon : EyeIcon}
                    title={isHidden ? "show" : "hide"}
                    onClick={() => onToggle("hidden", id)}
                  />
                  <IconButton
                    icon={isLocked ? LockIcon : LockOpenIcon}
                    title={isLocked ? "unlock" : "lock"}
                    onClick={() => onToggle("locked", id)}
                  />
                  <IconButton
                    icon={TrashIcon}
                    title="delete track"
                    danger
                    onClick={() => {
                      delete def.tracks[role];
                      routes.set(w, name, def);
                    }}
                  />
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Double-click to rename; Enter or blur commits, Escape gives up */
function EditableName({
  value,
  onCommit,
  className,
}: {
  value: string;
  onCommit(next: string): void;
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  if (editing === false) {
    return (
      <span className={cn("truncate", className)} title="double-click to rename" onDoubleClick={() => setEditing(true)}>
        {value}
      </span>
    );
  }
  return (
    <input
      autoFocus
      defaultValue={value}
      className="min-w-0 flex-1 bg-slate-950 border border-slate-600 rounded px-1 outline-none"
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        setEditing(false);
        onCommit(e.currentTarget.value.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setEditing(false);
      }}
    />
  );
}

function IconButton(props: { icon: Icon; title: string; danger?: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      title={props.title}
      className={cn(
        "grid place-items-center size-5 rounded cursor-pointer text-slate-500 hover:bg-slate-700",
        props.danger === true ? "hover:text-red-300" : "hover:text-slate-200",
      )}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick();
      }}
    >
      <props.icon className="size-3.5" />
    </button>
  );
}

/** The first of `name(1)`, `name(2)`… not already a key */
function firstFree(name: (i: number) => string, taken: Record<string, unknown>) {
  for (let i = 1; ; i++) if (!(name(i) in taken)) return name(i);
}

type Props = {
  w: WorldState;
  all: Record<string, Route>;
  selected: string | null;
  hidden: string[];
  locked: string[];
  onSelect(id: string | null): void;
  onToggle(list: "hidden" | "locked", id: string): void;
};
