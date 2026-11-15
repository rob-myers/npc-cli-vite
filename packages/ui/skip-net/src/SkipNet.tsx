import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { cn, type PaneLeaf, paneTree, useStateRef } from "@npc-cli/util";
import { useContext, useEffect } from "react";
import { SkipNetContext, type SplitEdge, type State } from "./context";
import { SkipNetPanes } from "./SkipNetPanes";
import type { SkipNetLeaf, SkipNetPaneNode, SkipNetUiMeta } from "./schema";
import { useSkipNetItems } from "./use-skip-net-items";

/** The intranet holding SCPs, aligned with one World. See `docs/skip-net.md` */
export default function SkipNet({ meta }: { meta: SkipNetUiMeta }) {
  const { uiStoreApi } = useContext(UiContext);

  const state = useStateRef(
    (): State => ({
      clearArmed: false,
      clearTimeoutId: 0,
      drag: null,
      dropEl: null,
      items: [],
      meta,
      rootEl: null,

      cancelDrag() {
        window.removeEventListener("keydown", state.onDragKey, true);
        state.drag = null;
        state.dropEl?.style.setProperty("opacity", "0");
      },
      clear() {
        window.clearTimeout(state.clearTimeoutId);
        if (state.clearArmed === false) {
          state.clearTimeoutId = window.setTimeout(() => state.set({ clearArmed: false }), clearConfirmMs);
          return state.set({ clearArmed: true });
        }
        state.set({ clearArmed: false });
        state.setPanes({ type: "leaf", id: 1, kind: null });
      },
      close(paneId) {
        const root = state.meta.panes;
        state.setPanes(paneTree.removeNode(root, paneId) ?? newLeaf(root));
      },
      endDrag() {
        const { drag } = state;
        if (drag === null) return;
        state.cancelDrag();
        const root = state.meta.panes;
        if (drag.targetId === null || drag.edge === null) return;
        if (drag.targetId === drag.sourceId && drag.edge !== "center") {
          // onto its own edge: it moves there, and an empty pane takes the rest
          state.setPanes(paneTree.splitNode(root, drag.sourceId, newLeaf(root), oppositeEdge[drag.edge]));
        } else {
          state.setPanes(paneTree.moveNode(root, drag.sourceId, drag.targetId, drag.edge));
        }
      },
      ensureJobs() {
        let root = state.meta.panes;
        const find = (kind: SkipNetLeaf["kind"]) => paneTree.leaves(root).find((x) => x.kind === kind);
        /** An empty pane takes it, else it goes beside `by`, else right of everything */
        const place = (kind: "jobs" | "library", by: undefined | { id: number }, edge: "top" | "bottom") => {
          const empty = find(null);
          if (empty !== undefined) {
            root = paneTree.transformNode(root, empty.id, (node) => ({ type: "leaf", id: node.id, kind }));
          } else {
            root = paneTree.splitNode(root, by?.id ?? root.id, newLeaf(root, kind), by === undefined ? "right" : edge);
          }
        };
        if (find("jobs") === undefined) place("jobs", find("library"), "top");
        if (find("library") === undefined) place("library", find("jobs"), "bottom");
        if (root !== state.meta.panes) state.setPanes(root);
      },
      moveDrag(e) {
        const { drag, dropEl, rootEl } = state;
        if (drag === null || dropEl === null || rootEl === null) return;
        if (drag.moved === false && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < dragStartPx) return;
        drag.moved = true;
        const atPoint = document.elementsFromPoint(e.clientX, e.clientY);
        const paneEl = atPoint.find(
          (el): el is HTMLElement =>
            el instanceof HTMLElement && el.dataset.paneId !== undefined && rootEl.contains(el),
        );
        const hide = () => {
          drag.targetId = null;
          dropEl.style.opacity = "0";
        };
        if (paneEl === undefined) return hide();
        const targetId = Number(paneEl.dataset.paneId);
        const rect = paneEl.getBoundingClientRect();
        /** Another pane's grip, which swaps them */
        const onGrip =
          targetId !== drag.sourceId &&
          atPoint.some((el) => el instanceof HTMLElement && el.dataset.paneGrip !== undefined);
        const edge = onGrip
          ? "center"
          : toEdge((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
        if (edge === null) return hide();
        drag.targetId = targetId;
        drag.edge = edge;
        // a swap marks the other's header, else the half it would take
        const headerRect = paneEl.querySelector("header")?.getBoundingClientRect();
        const [l, t, w, h] = edge === "center" ? [0, 0, 1, (headerRect?.height ?? 0) / rect.height] : dropRects[edge];
        const rootRect = rootEl.getBoundingClientRect();
        dropEl.dataset.swap = `${edge === "center"}`;
        Object.assign(dropEl.style, {
          opacity: "1",
          left: `${rect.left - rootRect.left + l * rect.width}px`,
          top: `${rect.top - rootRect.top + t * rect.height}px`,
          width: `${w * rect.width}px`,
          height: `${h * rect.height}px`,
        });
      },
      onDragKey(e) {
        if (e.key !== "Escape") return;
        e.stopPropagation(); // the World's own escape stays put
        state.cancelDrag();
      },
      setLeaf(paneId, leaf) {
        state.setPanes(
          paneTree.transformNode(state.meta.panes, paneId, (node) => ({ type: "leaf", id: node.id, ...leaf })),
        );
      },
      setPanes(panes) {
        uiStoreApi.setUiMeta(state.meta.id, (draft) => void ((draft as SkipNetUiMeta).panes = panes));
      },
      setSizes(splitId, sizes) {
        state.setPanes(
          paneTree.transformNode(state.meta.panes, splitId, (node) =>
            node.type === "split" ? { ...node, sizes } : node,
          ),
        );
      },
      split(paneId, edge) {
        const root = state.meta.panes;
        state.setPanes(paneTree.splitNode(root, paneId, newLeaf(root), edge));
      },
      startDrag(e, paneId) {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        state.drag = { sourceId: paneId, targetId: null, edge: null, moved: false, x: e.clientX, y: e.clientY };
        window.addEventListener("keydown", state.onDragKey, true);
      },
    }),
  );

  state.meta = meta; // its handlers run long after this render
  state.items = useSkipNetItems(meta.worldKey);

  useEffect(
    () => () => {
      window.clearTimeout(state.clearTimeoutId);
      state.cancelDrag();
    },
    [],
  );

  return (
    <SkipNetContext.Provider value={state}>
      <div
        ref={(el) => void (state.rootEl = el)}
        className="relative size-full flex flex-col bg-gray-650 text-zinc-300 text-xs tracking-wide"
      >
        <header className="shrink-0 flex items-center gap-2 px-2 py-1 border-b border-zinc-800 text-zinc-500">
          <span>{meta.worldKey}</span>
          <button
            type="button"
            title="show jobs and library"
            className="ml-auto px-2 rounded border border-zinc-800 cursor-pointer hover:bg-zinc-800 hover:text-zinc-200"
            onClick={state.ensureJobs}
          >
            jobs
          </button>
          <button
            type="button"
            title={state.clearArmed ? "press again to clear every pane" : "clear every pane"}
            className={cn(
              "px-2 rounded border cursor-pointer",
              state.clearArmed
                ? "border-red-400/60 text-red-300 hover:bg-red-950"
                : "border-zinc-800 hover:bg-zinc-800 hover:text-zinc-200",
            )}
            onClick={state.clear}
          >
            {state.clearArmed ? "sure?" : "clear"}
          </button>
        </header>
        <div className="flex-1 min-h-0">
          <SkipNetPanes node={meta.panes} />
        </div>
        <div
          ref={(el) => void (state.dropEl = el)}
          className={cn(
            "absolute z-20 opacity-0 transition-opacity duration-150 pointer-events-none rounded bg-sky-500/25 border border-sky-400",
            "data-[swap=true]:bg-amber-500/30 data-[swap=true]:border-amber-400",
          )}
        />
      </div>
    </SkipNetContext.Provider>
  );
}

/** An empty pane, unless `kind` is given, its id new to `root` */
function newLeaf(root: SkipNetPaneNode, kind: SkipNetLeaf["kind"] = null): PaneLeaf<SkipNetLeaf> {
  return { type: "leaf", id: paneTree.maxPaneId(root) + 1, kind };
}

/** The edge whose middle is near a point in a pane, as fractions of it, else `null` */
function toEdge(u: number, v: number): null | SplitEdge {
  const near = (depth: number, along: number) => depth < edgeDepth && Math.abs(along - 0.5) < edgeHalfWidth;
  if (near(u, v)) return "left";
  if (near(1 - u, v)) return "right";
  if (near(v, u)) return "top";
  if (near(1 - v, u)) return "bottom";
  return null;
}

/** How long a first press of clear waits for the second */
const clearConfirmMs = 3000;
const oppositeEdge = { left: "right", right: "left", top: "bottom", bottom: "top" } as const;
/** Pixels a grip moves before it drags */
const dragStartPx = 6;
/** How far into a pane an edge's drop zone reaches, as a fraction of it */
const edgeDepth = 0.25;
/** Half an edge's drop zone along it, either side of its middle, as a fraction */
const edgeHalfWidth = 0.25;
/** Where a drop lands in its pane, as left, top, width and height fractions */
const dropRects: Record<SplitEdge, [number, number, number, number]> = {
  left: [0, 0, 0.5, 1],
  right: [0.5, 0, 0.5, 1],
  top: [0, 0, 1, 0.5],
  bottom: [0, 0.5, 1, 0.5],
};
