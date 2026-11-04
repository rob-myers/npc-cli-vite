import type { WorldState } from "@npc-cli/ui__world";
import type { PatrolEntry } from "@npc-cli/ui__world/scenario.schema";
import { useEffect } from "react";
import { isPress, stepOf, toMap } from "./decor-edit";
import { legsOf, movedPoint, snapped } from "./patrol-edit";

/**
 * On the map, the chosen patrol: its legs, an arrow on each the way it is walked, and a numbered handle per point.
 * Editable, a handle drags its point, and a leg the whole patrol, snapped onto the navmesh on release.
 * Off it, what was dragged springs back
 */
export function PatrolLayer({ w, patrol, editable, onCommit, onPressing }: Props) {
  useEffect(() => () => onPressing(false), []); // a press cut short by an unmount blocks nothing

  function onHandlePointerDown(e: React.PointerEvent<SVGGElement>, i: number) {
    if (editable === false || isPress(e) === false) return;
    e.stopPropagation();
    const handle = e.currentTarget; // React drops `currentTarget` once the handler returns
    const svg = handle.ownerSVGElement;
    if (svg === null) return;
    handle.setPointerCapture(e.pointerId);
    onPressing(true);
    const from = patrol.points[i];
    const start = toMap(svg, e.clientX, e.clientY);
    let [to, travel] = [from, 0];
    const onMove = (ev: PointerEvent) => {
      const at = toMap(svg, ev.clientX, ev.clientY);
      const step = stepOf(ev, false);
      const [x, y] = [from[0] + at.x - start.x, from[1] + at.y - start.y];
      to = step === undefined ? [x, y] : [Math.round(x / step) * step, Math.round(y / step) * step];
      travel = Math.max(travel, Math.hypot(at.x - start.x, at.y - start.y));
      place(svg, i, to, true);
    };
    const onEnd = (commit: boolean) => () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onLost);
      handle.removeEventListener("lostpointercapture", onLost);
      onPressing(false);
      place(svg, i, from, false); // React redraws it where it ends
      const at = commit && travel >= dragThreshold ? snapped(w, { x: to[0], y: to[1] }) : null;
      if (at !== null) onCommit(movedPoint(patrol, i, at));
    };
    const [onUp, onLost] = [onEnd(true), onEnd(false)];
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onLost);
    handle.addEventListener("lostpointercapture", onLost); // e.g. the window lost focus mid-drag
  }

  function onLegPointerDown(e: React.PointerEvent<SVGLineElement>) {
    if (editable === false || isPress(e) === false) return;
    e.stopPropagation();
    const leg = e.currentTarget;
    const group = leg.closest("[data-patrol]");
    const svg = leg.ownerSVGElement;
    if (svg === null || group === null) return;
    leg.setPointerCapture(e.pointerId);
    onPressing(true);
    const start = toMap(svg, e.clientX, e.clientY);
    let [dx, dy, travel] = [0, 0, 0];
    const onMove = (ev: PointerEvent) => {
      const at = toMap(svg, ev.clientX, ev.clientY);
      const step = stepOf(ev, false);
      [dx, dy] = [at.x - start.x, at.y - start.y];
      travel = Math.max(travel, Math.hypot(dx, dy));
      if (step !== undefined) [dx, dy] = [Math.round(dx / step) * step, Math.round(dy / step) * step];
      group.setAttribute("transform", `translate(${dx} ${dy})`);
    };
    const onEnd = (commit: boolean) => () => {
      leg.removeEventListener("pointermove", onMove);
      leg.removeEventListener("pointerup", onUp);
      leg.removeEventListener("pointercancel", onLost);
      leg.removeEventListener("lostpointercapture", onLost);
      onPressing(false);
      group.removeAttribute("transform"); // React redraws it where it ends
      if (commit === false || travel < dragThreshold) return;
      const points = patrol.points.map(([x, y]) => snapped(w, { x: x + dx, y: y + dy }));
      if (points.every((p) => p !== null)) onCommit({ ...patrol, points });
    };
    const [onUp, onLost] = [onEnd(true), onEnd(false)];
    leg.addEventListener("pointermove", onMove);
    leg.addEventListener("pointerup", onUp);
    leg.addEventListener("pointercancel", onLost);
    leg.addEventListener("lostpointercapture", onLost);
  }

  const legs = legsOf(patrol);
  return (
    <g data-patrol={patrol.key}>
      {legs.map(({ i, a, b }) => {
        const angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
        return (
          <g key={i} pointerEvents={editable ? undefined : "none"}>
            {/* wide and clear, so a press finds the leg: a drag moves the patrol, a right click opens the menu */}
            <line
              data-patrol-leg={i}
              data-no-pan={editable ? true : undefined}
              className={editable ? "cursor-move" : undefined}
              onPointerDown={onLegPointerDown}
              data-patrol-a={legEnd(i)}
              data-patrol-b={legEnd((i + 1) % patrol.points.length)}
              x1={a[0]}
              y1={a[1]}
              x2={b[0]}
              y2={b[1]}
              stroke="transparent"
              strokeWidth={12}
              vectorEffect="non-scaling-stroke"
            />
            <line
              data-patrol-a={legEnd(i)}
              data-patrol-b={legEnd((i + 1) % patrol.points.length)}
              x1={a[0]}
              y1={a[1]}
              x2={b[0]}
              y2={b[1]}
              stroke={ink.patrol}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
            <path
              data-patrol-arrow={`${i} ${(i + 1) % patrol.points.length}`}
              d="M -0.12 -0.08 L 0.04 0 L -0.12 0.08"
              transform={`translate(${(a[0] + b[0]) / 2} ${(a[1] + b[1]) / 2}) rotate(${angle})`}
              fill="none"
              stroke={ink.patrol}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          </g>
        );
      })}
      {patrol.points.map(([x, y], i) => (
        <g
          key={i}
          data-patrol-point={i}
          data-no-pan={editable ? true : undefined}
          transform={`translate(${x} ${y})`}
          className={editable ? "cursor-grab" : undefined}
          pointerEvents={editable ? undefined : "none"}
          onPointerDown={(e) => onHandlePointerDown(e, i)}
        >
          <circle r={handleRadius} fill={ink.patrol} />
          <text
            fontSize={handleRadius * 1.3}
            fill={ink.text}
            textAnchor="middle"
            dominantBaseline="central"
            pointerEvents="none"
          >
            {i}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Point `i`'s handle at `to`, and the ends of its legs. Their arrows are hidden whilst `dragging` */
function place(svg: SVGSVGElement, i: number, to: [number, number], dragging: boolean) {
  const [x, y] = to.map(String);
  svg.querySelector(`[data-patrol-point="${i}"]`)?.setAttribute("transform", `translate(${x} ${y})`);
  for (const el of svg.querySelectorAll(`[data-patrol-a="${legEnd(i)}"]`))
    el.setAttribute("x1", x), el.setAttribute("y1", y);
  for (const el of svg.querySelectorAll(`[data-patrol-b="${legEnd(i)}"]`))
    el.setAttribute("x2", x), el.setAttribute("y2", y);
  for (const el of svg.querySelectorAll<SVGElement>("[data-patrol-arrow]")) {
    const ends = el.getAttribute("data-patrol-arrow")?.split(" ") ?? [];
    el.style.visibility = dragging && ends.includes(String(i)) ? "hidden" : "";
  }
}

/** A leg's end, as its data attribute names it */
const legEnd = (i: number) => `p${i}`;

type Props = {
  w: WorldState;
  patrol: PatrolEntry;
  /** DEV, where a save reaches the file */
  editable: boolean;
  onCommit(next: PatrolEntry): void;
  /** A press began or ended: whilst one is under way the context menu stays shut */
  onPressing(pressing: boolean): void;
};

/** Metres */
const handleRadius = 0.16;
/** In map metres: less is a click */
const dragThreshold = 0.02;
const ink = { patrol: "var(--deco-patrol)", text: "var(--deco-patrol-text)" };
