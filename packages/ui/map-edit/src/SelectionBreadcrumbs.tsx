import { cn, type UseStateRef } from "@npc-cli/util";
import { CaretRightIcon, LockIcon } from "@phosphor-icons/react";
import { Fragment, useMemo, useRef } from "react";
import type { State } from "./MapEdit";
import { findNodeById, findNodePath } from "./map-node-api";

/** The selection's folders over the map, as in BoxySVG. A crumb selects its node. */
export function SelectionBreadcrumbs({ root }: { root: UseStateRef<State> }) {
  const crumbs = useMemo(() => {
    const ids = [...root.selectedIds];
    if (ids.length === 0) return null;
    const path = findNodePath(root.nodes, ids[0]);
    if (ids.length === 1) return { path, count: 1 };
    const parentIds = new Set(ids.map((id) => findNodeById(root.nodes, id)[1]?.id ?? null));
    return { path: parentIds.size === 1 ? path.slice(0, -1) : [], count: ids.length };
  }, [root.selectedIds, root.nodes]);
  const downAt = useRef({ x: 0, y: 0 });

  if (crumbs === null) return null;

  const select = (e: React.MouseEvent, id: string) => {
    if (Math.hypot(e.clientX - downAt.current.x, e.clientY - downAt.current.y) > 4) return; // a drag selects text
    root.set({ selectedIds: new Set([id]), selectionBox: null });
    root.scrollInspectorNodeIntoView(id);
  };

  return (
    <div
      className={cn(
        "absolute top-0 inset-x-0 z-10 flex flex-wrap items-center gap-1 px-2 py-1 text-sm pointer-events-none select-none",
        "border-b border-slate-300 bg-slate-100/90 text-slate-500",
        "dark:border-neutral-700 dark:bg-neutral-800/85 dark:text-neutral-400",
      )}
    >
      {crumbs.path.map((node, i) => (
        <Fragment key={node.id}>
          {i > 0 && <CaretRightIcon className="size-3 opacity-60" />}
          <span
            className={cn(
              "flex items-center gap-1 pointer-events-auto cursor-pointer select-all hover:text-slate-900 dark:hover:text-neutral-100",
              crumbs.count === 1 && i === crumbs.path.length - 1 && "text-slate-900 dark:text-neutral-100",
            )}
            onPointerDown={(e) => (downAt.current = { x: e.clientX, y: e.clientY })}
            onClick={(e) => select(e, node.id)}
          >
            {node.name}
            {node.locked && <LockIcon className="size-3 text-red-400" />}
          </span>
        </Fragment>
      ))}
      {crumbs.count > 1 && (
        <>
          {crumbs.path.length > 0 && <CaretRightIcon className="size-3 opacity-60" />}
          <span className="text-slate-900 dark:text-neutral-100">{crumbs.count} selected</span>
        </>
      )}
    </div>
  );
}
