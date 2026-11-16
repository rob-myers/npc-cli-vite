import { cn, useStateRef } from "@npc-cli/util";
import type React from "react";
import { useContext, useEffect, useMemo } from "react";
import { SkipNetContext } from "../context";
import { deskStyle } from "./classes";
import { DesktopIcons } from "./DesktopIcons";
import { Window } from "./Window";
import { frontOf, stackOrdered } from "./windows";

/**
 * A narrow panel's windows, as an accordion: the open ones share its height, the folded ones are bars.
 * A bar dragged moves the boundary between the open windows either side of it.
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
      eatClick: false,

      onClickCapture(e) {
        if (!stack.eatClick) return;
        stack.eatClick = false;
        e.stopPropagation(); // a drag's release, not a tap
      },
      onPointerDown(e) {
        stack.eatClick = false;
        const target = e.target as HTMLElement;
        const bar = target.closest("header");
        if (bar === null || target.closest("button") !== null) return;
        const els = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-stack-id]")];
        const at = els.findIndex((el) => el.contains(bar));
        const open = els.filter((el) => el.dataset.open === "true");
        stack.drag = {
          above: els.slice(0, at).findLast((el) => el.dataset.open === "true") ?? null,
          below: els.slice(at).find((el) => el.dataset.open === "true") ?? null,
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
        if (drag === null || drag.above === null || drag.below === null) return;
        const dy = e.clientY - drag.y;
        if (!drag.moved && Math.abs(dy) < dragStartPx) return;
        drag.moved = true;
        const above = drag.heights.get(drag.above) ?? 0;
        const total = above + (drag.heights.get(drag.below) ?? 0);
        const next = Math.min(Math.max(above + dy, stackMinPx), total - stackMinPx);
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
        stack.eatClick = true;
        state.setStackFlex(
          Object.fromEntries([...drag.heights.keys()].map((el) => [el.dataset.stackId, Number(el.style.flexGrow)])),
        );
      },
    }),
  );

  useEffect(() => stack.onPointerUp, []);

  if (windows.length === 0) {
    return (
      <div className="flex-1 min-h-0 overflow-auto" style={deskStyle}>
        <DesktopIcons layout="row" />
      </div>
    );
  }

  return (
    <div
      className="flex-1 min-h-0 flex flex-col gap-0.5 p-1 overflow-y-auto"
      style={deskStyle}
      onPointerDown={stack.onPointerDown}
      onClickCapture={stack.onClickCapture}
    >
      {ordered.map((win, i) => {
        const open = win.shadedH === undefined;
        return (
          <div
            key={win.id}
            data-stack-id={win.id}
            data-open={open}
            className={cn(open ? "flex-1 min-h-32" : "shrink-0 h-5")}
            style={open ? { flexGrow: win.stackFlex ?? win.h } : undefined}
            onPointerDownCapture={() => state.bringToFront(win.id)}
          >
            <Window win={win} front={win.id === front?.id} stack={{ first: i === 0, last: i === ordered.length - 1 }} />
          </div>
        );
      })}
    </div>
  );
}

type StackState = {
  /** A bar being dragged: the open windows either side of it, and each open window's height at the start */
  drag: null | {
    above: null | HTMLElement;
    below: null | HTMLElement;
    heights: Map<HTMLElement, number>;
    moved: boolean;
    y: number;
  };
  /** A drag just ended, so the click its release makes is not a tap */
  eatClick: boolean;
  onClickCapture(e: React.MouseEvent): void;
  onPointerDown(e: React.PointerEvent<HTMLDivElement>): void;
  onPointerMove(e: PointerEvent): void;
  onPointerUp(): void;
};

/** Pixels a bar moves before it drags rather than taps */
const dragStartPx = 6;
/** An open window's least height in a stack, as its `min-h-32` */
const stackMinPx = 128;
