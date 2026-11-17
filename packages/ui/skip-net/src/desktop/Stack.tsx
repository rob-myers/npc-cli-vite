import { cn, tw, useStateRef } from "@npc-cli/util";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import type React from "react";
import { useContext, useEffect, useMemo } from "react";
import { SkipNetContext } from "../context";
import { deskStyle } from "./classes";
import { DesktopIcons } from "./DesktopIcons";
import { Window } from "./Window";
import { frontOf, stackOrdered } from "./windows";

/**
 * A narrow panel's windows, as an accordion: the open ones share its height, the folded ones are bars.
 * A bar's grip dragged moves the boundary between the windows either side of it.
 * Dragged far enough it folds one, or unfolds a folded one: down the window above, up its own.
 */
export function Stack() {
  const state = useContext(SkipNetContext);
  const { windows } = state.meta;
  const front = frontOf(windows);
  /** Fronting one never moves it */
  const ordered = useMemo(() => stackOrdered(windows), [windows]);

  const stack = useStateRef(
    (): StackState => ({
      drag: null,

      onPointerDown(e) {
        const target = e.target as HTMLElement;
        const els = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-stack-id]")];
        // a window's bottom edge drags as the next one's grip does: the same boundary
        const edgeOf = target.closest<HTMLElement>("[data-stack-edge]")?.closest<HTMLElement>("[data-stack-id]");
        const bar =
          edgeOf != null
            ? (els[els.indexOf(edgeOf) + 1]?.querySelector("header") ?? null)
            : target.closest("[data-stack-grip]") !== null
              ? target.closest("header")
              : null;
        if (bar === null) return;
        const at = els.findIndex((el) => el.contains(bar));
        const open = els.filter((el) => el.dataset.open === "true");
        const folded = (el: undefined | HTMLElement) => (el !== undefined && el.dataset.open !== "true" ? el : null);
        stack.drag = {
          bar,
          foldedOwn: folded(els[at]),
          foldedPrev: folded(els[at - 1]),
          unfold: null,
          above: els.slice(0, at).findLast((el) => el.dataset.open === "true") ?? null,
          below: els.slice(at).find((el) => el.dataset.open === "true") ?? null,
          flexes: new Map(open.map((el) => [el, el.style.flexGrow])),
          folding: null,
          heights: new Map(open.map((el) => [el, el.offsetHeight])),
          moved: false,
          y: e.clientY,
        };
        window.addEventListener("pointermove", stack.onPointerMove);
        window.addEventListener("pointerup", stack.onPointerUp);
        window.addEventListener("pointercancel", stack.onPointerUp);
      },
      onPointerMove(e) {
        const { drag } = stack;
        if (drag === null) return;
        const dy = e.clientY - drag.y;
        if (!drag.moved && Math.abs(dy) < dragStartPx) return;
        if (!drag.moved) {
          // the window above folded and dragged down, or its own folded and dragged up, unfolds
          const el = dy > 0 ? drag.foldedPrev : drag.foldedOwn;
          if (el !== null) {
            const shrink = dy > 0 ? drag.below : drag.above;
            drag.unfold = { el, from: el.offsetHeight, grow: 0, shrink, sign: dy > 0 ? 1 : -1 };
            el.setAttribute("data-unfolding", "");
            shrink?.setAttribute("data-resizing", "");
          }
          stack.showDrag(drag, true);
        }
        drag.moved = true;
        if (drag.unfold !== null) return stack.unfoldTo(drag.unfold, drag.heights, drag.unfold.sign * dy);
        if (drag.above === null || drag.below === null) return;
        const above = drag.heights.get(drag.above) ?? 0;
        const total = above + (drag.heights.get(drag.below) ?? 0);
        const next = Math.min(Math.max(above + dy, stackMinPx), total - stackMinPx);
        // dragged well past either window's least height, letting go folds it: down, the bar's own window
        const folding =
          above + dy > total - stackMinPx + foldPx && drag.below.contains(drag.bar)
            ? drag.below
            : above + dy < stackMinPx - foldPx
              ? drag.above
              : null;
        if (folding !== drag.folding) {
          drag.folding?.removeAttribute("data-folding");
          folding?.setAttribute("data-folding", "");
          if (folding !== null) navigator.vibrate?.(10);
          drag.folding = folding;
        }
        // written straight to the DOM whilst dragging, then saved once let go
        for (const [el, h] of drag.heights) {
          el.style.flexGrow = `${el === drag.above ? next : el === drag.below ? total - next : h}`;
        }
      },
      onPointerUp() {
        window.removeEventListener("pointermove", stack.onPointerMove);
        window.removeEventListener("pointerup", stack.onPointerUp);
        window.removeEventListener("pointercancel", stack.onPointerUp);
        const { drag } = stack;
        stack.drag = null;
        if (drag?.moved !== true) return;
        stack.showDrag(drag, false);
        if (drag.unfold !== null) {
          const { el, from, grow, shrink } = drag.unfold;
          el.style.height = "";
          el.removeAttribute("data-folding");
          el.removeAttribute("data-unfolding");
          shrink?.removeAttribute("data-resizing");
          if (grow < foldPx) {
            for (const [x, flex] of drag.flexes) x.style.flexGrow = flex; // too little: it stays folded
            return;
          }
          const flexById = Object.fromEntries(
            [...drag.heights].map(([x, h]) => [x.dataset.stackId, x === shrink ? h - grow : h]),
          );
          return state.setStackFlex({ ...flexById, [el.dataset.stackId as string]: from + grow }, el.dataset.stackId);
        }
        if (drag.folding !== null) {
          drag.folding.removeAttribute("data-folding");
          for (const [el, flex] of drag.flexes) el.style.flexGrow = flex; // the drag undone, then the fold
          return state.toggleShade(drag.folding.dataset.stackId as string);
        }
        state.setStackFlex(
          Object.fromEntries([...drag.heights.keys()].map((el) => [el.dataset.stackId, Number(el.style.flexGrow)])),
        );
      },
      showDrag(drag, shown) {
        drag.bar.toggleAttribute("data-dragging", shown);
        if (drag.unfold !== null) {
          drag.unfold.el.toggleAttribute("data-resizing", shown);
        } else {
          drag.above?.toggleAttribute("data-resizing", shown);
          drag.below?.toggleAttribute("data-resizing", shown);
        }
        if (shown) navigator.vibrate?.(10);
      },
      unfoldTo(unfold, heights, px) {
        const { el, from, shrink } = unfold;
        const room = shrink === null ? Number.POSITIVE_INFINITY : (heights.get(shrink) ?? 0) - stackMinPx;
        unfold.grow = Math.max(0, Math.min(px, room));
        // its frame grows to the finger, the window giving room shrinking as much
        el.style.height = `${from + unfold.grow}px`;
        el.toggleAttribute("data-folding", unfold.grow < foldPx);
        for (const [x, h] of heights) x.style.flexGrow = `${x === shrink ? h - unfold.grow : h}`;
      },
    }),
  );

  useEffect(() => stack.onPointerUp, []);

  return (
    <div
      className="flex-1 min-h-0 flex flex-col gap-0.5 p-1 overflow-y-auto"
      style={deskStyle}
      onPointerDown={stack.onPointerDown}
    >
      {ordered.map((win, i) => {
        const open = win.shadedH === undefined;
        return (
          <div
            key={win.id}
            data-stack-id={win.id}
            data-open={open}
            className={cn("relative", open ? "flex-1 min-h-32" : "shrink-0", resizingClass)}
            style={open ? { flexGrow: win.stackFlex ?? win.h } : undefined}
            onPointerDownCapture={() => state.bringToFront(win.id)}
          >
            <Window win={win} front={win.id === front?.id} stack={{ first: i === 0, last: i === ordered.length - 1 }} />
            {!touchDevice && i < ordered.length - 1 && <div data-stack-edge className={edgeClass} />}
          </div>
        );
      })}
      {/* with every window folded, the desk shows below their bars */}
      {ordered.every((win) => win.shadedH !== undefined) && <DesktopIcons layout="row" />}
    </div>
  );
}

type StackState = {
  /** A bar being dragged: the open windows either side of it, and each open window's height at the start */
  drag: null | {
    /** The bar dragged, by its grip */
    bar: HTMLElement;
    /** Its own window, if folded */
    foldedOwn: null | HTMLElement;
    /** The window just above it, if folded */
    foldedPrev: null | HTMLElement;
    /** A folded window being dragged open, by `grow` px, `shrink` giving the room */
    unfold: null | Unfold;
    /** Each open window's share before the drag, restored if it folds one instead */
    flexes: Map<HTMLElement, string>;
    /** The window letting go would fold, dragged well past its least height */
    folding: null | HTMLElement;
    above: null | HTMLElement;
    below: null | HTMLElement;
    heights: Map<HTMLElement, number>;
    moved: boolean;
    y: number;
  };
  onPointerDown(e: React.PointerEvent<HTMLDivElement>): void;
  onPointerMove(e: PointerEvent): void;
  onPointerUp(): void;
  /** Marks the bar dragged and the windows it resizes, with a short buzz on touch */
  showDrag(drag: NonNullable<StackState["drag"]>, shown: boolean): void;
  /** Grows a folded window's frame `px` towards the finger, within the room the other leaves */
  unfoldTo(unfold: Unfold, heights: Map<HTMLElement, number>, px: number): void;
};

/** `sign` is the way it opens: down for the window above, up for the bar's own */
type Unfold = { el: HTMLElement; from: number; grow: number; shrink: null | HTMLElement; sign: 1 | -1 };

/** The two windows a drag resizes, outlined, dimmed if letting go would fold it, and greyed whilst still unmounted */
const resizingClass = tw(
  "transition-opacity data-resizing:outline-1 data-resizing:outline-dashed data-resizing:outline-mac-muted data-folding:opacity-50 data-unfolding:*:bg-mac-desk",
);
/** Pixels past a window's least height a grip is dragged to fold it */
const foldPx = 40;
/** A window's bottom edge, an invisible strip to drag with a mouse, as the desktop's edges are */
const edgeClass = tw("absolute inset-x-0 -bottom-1 z-10 h-2 cursor-row-resize");
const touchDevice = isTouchDevice();
/** Pixels a grip moves before it drags */
const dragStartPx = 6;
/** An open window's least height in a stack, as its `min-h-32` */
const stackMinPx = 128;
