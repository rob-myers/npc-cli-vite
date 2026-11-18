import { cn, tw, useStateRef } from "@npc-cli/util";
import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useContext, useEffect, useMemo } from "react";
import { flushSync } from "react-dom";
import { SkipNetContext } from "../context";
import { deskStyle } from "./classes";
import { DesktopIcons } from "./DesktopIcons";
import { Window } from "./Window";
import { frontOf, stackOrdered } from "./windows";

/**
 * A narrow panel's windows as an accordion. A bar's grip moves the boundary between the windows either side, or unfolds one.
 * Dragged far enough it holds, offering to collapse one or move its own window that way, chosen by letting go over one.
 */
export function Stack() {
  const state = useContext(SkipNetContext);
  const { windows } = state.meta;
  const front = frontOf(windows);
  /** Fronting one never moves it */
  const ordered = useMemo(() => stackOrdered(windows), [windows]);
  /** Each window in order, and whether open: a change slides the windows to their new places */
  const layoutKey = ordered.map((x) => `${x.id}:${x.shadedH === undefined}`).join(" ");

  const stack = useStateRef(
    (): StackState => ({
      choice: null,
      drag: null,
      unfoldingId: null,

      choiceAt(drag, folding, dir) {
        const box = drag.container.getBoundingClientRect();
        const rect = folding.getBoundingClientRect();
        /** Its contents, below its bar */
        const top = rect.top + (folding.querySelector("header")?.offsetHeight ?? 0);
        return {
          x: rect.left - box.left + rect.width / 2,
          y: (top + rect.bottom) / 2 - box.top + drag.container.scrollTop,
          dir,
          over: "fold",
        };
      },
      hoverChoice(e) {
        const { choice, drag } = stack;
        if (choice === null) return;
        const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-stack-choice]");
        const over = el?.dataset.stackChoice === "move" ? "move" : "fold"; // collapse unless over "move"
        if (over === choice.over) return;
        stack.set({ choice: { ...choice, over } });
        drag?.folding?.toggleAttribute("data-folding", over === "fold"); // dimmed, as it would fold
      },
      isEdge(el, dir) {
        const ordered = stackOrdered(state.meta.windows);
        const i = ordered.findIndex((x) => x.id === el.dataset.stackId);
        return dir < 0 ? i === 0 : i === ordered.length - 1;
      },
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
          container: e.currentTarget,
          own: els[at]?.dataset.stackId ?? "",
          foldedOwn: folded(els[at]),
          foldedPrev: folded(els[at - 1]),
          unfold: null,
          above: els.slice(0, at).findLast((el) => el.dataset.open === "true") ?? null,
          below: els.slice(at).find((el) => el.dataset.open === "true") ?? null,
          flexes: new Map(open.map((el) => [el, el.style.flexGrow])),
          folding: null,
          foldY: 0,
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
            stack.set({ unfoldingId: el.dataset.stackId ?? null }); // its contents mount, to be seen
          }
          stack.showDrag(drag, true);
        }
        drag.moved = true;
        if (drag.unfold !== null) return stack.unfoldTo(drag.unfold, drag.heights, drag.unfold.sign * dy);
        // once offered, the choices hold the drag, the finger only picking. They lie ahead, the way it was dragged
        if (stack.choice !== null) {
          // dragged back the other way, away from them, they go and the drag resumes
          if ((e.clientY - drag.foldY) * stack.choice.dir > -cancelPx) return stack.hoverChoice(e);
          stack.set({ choice: null });
          drag.folding?.removeAttribute("data-folding");
          drag.folding = null;
        }
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
          if (folding !== null) navigator.vibrate?.(10);
          drag.folding = folding;
          drag.foldY = e.clientY;
          const dir = dy > 0 ? 1 : -1;
          // the first dragged to the top, or the last to the bottom, has nowhere to move: it just collapses
          const atEdge = folding !== null && stack.isEdge(folding, dir);
          folding?.setAttribute("data-folding", ""); // dimmed, as by default it collapses
          stack.set({ choice: folding === null || atEdge ? null : stack.choiceAt(drag, folding, dir) });
        }
        stack.hoverChoice(e);
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
          el.removeAttribute("data-folding");
          stack.set({ unfoldingId: null });
          if (grow < foldPx) {
            el.style.height = "";
            for (const [x, flex] of drag.flexes) x.style.flexGrow = flex; // too little: it stays folded
            return;
          }
          const flexById = Object.fromEntries(
            [...drag.heights].map(([x, h]) => [x.dataset.stackId, x === shrink ? h - grow : h]),
          );
          // its shares as dragged, applied at once so the slide starts from there. Open, its share sizes it, not `height`
          flushSync(() =>
            state.setStackFlex({ ...flexById, [el.dataset.stackId as string]: from + grow }, el.dataset.stackId),
          );
          el.style.height = "";
          return;
        }
        if (drag.folding !== null) {
          const [choice, folding] = [stack.choice, drag.folding];
          stack.set({ choice: null });
          folding.removeAttribute("data-folding");
          // the shares kept as dragged, so nothing changes size after. A collapsed one keeps its own, for when it opens
          const foldId = folding.dataset.stackId as string;
          const flexById = sharesOf([...drag.heights.keys()].filter((el) => choice?.over === "move" || el !== folding));
          // let go anywhere but "move", it collapses
          if (choice?.over === "move") return state.moveInStack(drag.own, choice.dir, flexById);
          return state.setStackFlex(flexById, foldId);
        }
        state.setStackFlex(sharesOf([...drag.heights.keys()]));
      },
      showDrag(drag, shown) {
        drag.bar.toggleAttribute("data-dragging", shown);
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
    // `layoutScroll` so a slide is measured within its scroll
    <motion.div
      layoutScroll
      className="skip-net-stack relative flex-1 min-h-0 flex flex-col overflow-y-auto"
      style={deskStyle}
      onPointerDown={stack.onPointerDown}
    >
      {ordered.map((win, i) => {
        const open = win.shadedH === undefined;
        return (
          // a move or a fold slides it to its new place. Measured only then, as a drag sizes it directly
          <motion.div
            key={win.id}
            layout="position"
            layoutDependency={layoutKey}
            transition={moveTransition}
            data-stack-id={win.id}
            data-open={open}
            className={cn("relative", open ? "flex-1 min-h-32" : "shrink-0", foldingClass)}
            style={open ? { flexGrow: win.stackFlex ?? win.h } : undefined}
            onPointerDownCapture={() => state.bringToFront(win.id)}
          >
            <Window
              win={win}
              front={win.id === front?.id}
              items={state.items}
              peek={win.id === stack.unfoldingId}
              showAll={false}
              stack={{ last: i === ordered.length - 1 }}
            />
            {!touchDevice && i < ordered.length - 1 && <div data-stack-edge className={edgeClass} />}
          </motion.div>
        );
      })}
      <AnimatePresence>
        {stack.choice !== null && (
          // over the window they would collapse: let go over one to choose it
          <motion.div
            key="choices"
            className={choicesClass}
            style={{ left: stack.choice.x, top: stack.choice.y }}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.15 }}
          >
            <span data-stack-choice="fold" className={cn(choiceClass, stack.choice.over === "fold" && choiceOverClass)}>
              collapse
            </span>
            <span data-stack-choice="move" className={cn(choiceClass, stack.choice.over === "move" && choiceOverClass)}>
              {stack.choice.dir > 0 ? "move down" : "move up"}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
      {/* with every window folded, the desk shows below their bars */}
      {ordered.every((win) => win.shadedH !== undefined) && <DesktopIcons layout="row" />}
    </motion.div>
  );
}

type StackState = {
  /** Offered once a drag passes the fold point: collapse the window it would fold, or move the bar's own that way */
  choice: null | Choice;
  /** The choices, over the contents of the window they would collapse */
  choiceAt(drag: NonNullable<StackState["drag"]>, folding: HTMLElement, dir: -1 | 1): Choice;
  /** Whether `el` is the first in the stack, `dir` up, or the last, down: collapsed that way, it has nowhere to move */
  isEdge(el: HTMLElement, dir: -1 | 1): boolean;
  /** Notes the choice under the finger: "move", else "collapse", which dims the window it would fold */
  hoverChoice(e: PointerEvent): void;
  /** A bar being dragged: the open windows either side of it, and each open window's height at the start */
  drag: null | {
    /** The bar dragged, by its grip */
    bar: HTMLElement;
    /** The stack, which the choices are placed in */
    container: HTMLElement;
    /** Its window's id */
    own: string;
    /** Its own window, if folded */
    foldedOwn: null | HTMLElement;
    /** The window just above it, if folded */
    foldedPrev: null | HTMLElement;
    /** A folded window being dragged open, by `grow` px, `shrink` giving the room */
    unfold: null | Unfold;
    /** Each open window's share before the drag, restored if an unfold falls short */
    flexes: Map<HTMLElement, string>;
    /** Where the finger was as `folding` was set */
    foldY: number;
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
  /** Marks the bar dragged, with a short buzz on touch */
  showDrag(drag: NonNullable<StackState["drag"]>, shown: boolean): void;
  /** The folded window being dragged open, whose contents show meanwhile */
  unfoldingId: null | string;
  /** Grows a folded window's frame `px` towards the finger, within the room the other leaves */
  unfoldTo(unfold: Unfold, heights: Map<HTMLElement, number>, px: number): void;
};

/** Each window's share by id, as a drag has written them */
function sharesOf(els: HTMLElement[]): Record<string, number> {
  return Object.fromEntries(els.map((el) => [el.dataset.stackId, Number(el.style.flexGrow)]));
}

/** Where the choices show, in the stack's scrolled pixels, the way the drag went, and which is chosen: "fold" by default */
type Choice = { x: number; y: number; dir: -1 | 1; over: "fold" | "move" };

/** `sign` is the way it opens: down for the window above, up for the bar's own */
type Unfold = { el: HTMLElement; from: number; grow: number; shrink: null | HTMLElement; sign: 1 | -1 };

/** A stacked window, dimmed whilst it would collapse, or whilst dragged open too little to stay */
const foldingClass = tw("transition-opacity data-folding:opacity-50");
/** Pixels past a window's least height a grip is dragged to be offered the choices */
const foldPx = 40;
/** As wide as its pills: placed at the centre, it would otherwise get only the room to the stack's right edge */
const choicesClass = tw("absolute z-20 flex w-max gap-2 -translate-x-1/2 -translate-y-1/2");
const choiceClass = tw(
  "inline-flex items-center justify-center h-9 px-4 whitespace-nowrap rounded-full border border-mac-edge bg-mac-window text-mac-text text-sm leading-none font-bold shadow select-none",
);
/** The choice under the finger */
const choiceOverClass = tw("bg-mac-select text-mac-on-select");
/** Pixels the finger moves back, away from the choices, to dismiss them */
const cancelPx = 24;
/** A window's slide to its new place in the stack, after a move or a fold */
const moveTransition = { duration: 0.25, ease: "easeOut" } as const;
/** A window's bottom edge, an invisible strip to drag with a mouse, as the desktop's edges are */
const edgeClass = tw("absolute inset-x-0 -bottom-1 z-10 h-2 cursor-row-resize");
const touchDevice = isTouchDevice();
/** Pixels a grip moves before it drags */
const dragStartPx = 6;
/** An open window's least height in a stack, as its `min-h-32` */
const stackMinPx = 128;
