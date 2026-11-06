import type { WorldState } from "@npc-cli/ui__world";
import type { GraphEntry } from "@npc-cli/ui__world/scenario.schema";
import { useEffect, useRef } from "react";
import { isPress, snap, stepOf, toMap } from "./decor-edit";
import { type GraphTarget, movedNodes, type Pt, snapped } from "./graph-edit";

/**
 * On the map, the chosen graph: its edges, an arrow on each if directed, and a handle per node, ringed on a spot.
 * Editable, a handle drags its node off any spot, and an edge the whole graph, snapped onto the navmesh on release.
 * A click selects either, or ends a connect begun from a node's menu
 */
export function GraphLayer({
  w,
  graph,
  pointOf,
  editable,
  selected,
  connecting,
  onCommit,
  onSelect,
  onConnect,
  onPressing,
}: Props) {
  const ref = useRef<SVGGElement>(null);
  const connectLine = useRef<SVGLineElement>(null);
  useEffect(() => () => onPressing(false), []); // a press cut short by an unmount blocks nothing

  // the line from the node being connected follows the pointer
  useEffect(() => {
    const line = connectLine.current;
    const svg = line?.ownerSVGElement;
    if (line == null || svg == null) return;
    const onMove = (e: PointerEvent) => {
      const at = toMap(svg, e.clientX, e.clientY);
      line.setAttribute("x2", String(at.x));
      line.setAttribute("y2", String(at.y));
    };
    svg.addEventListener("pointermove", onMove);
    return () => svg.removeEventListener("pointermove", onMove);
  }, [connecting]);

  /** Follows a press until let go: each move by how far from where it began, then whether it ended a drag */
  function follow(e: React.PointerEvent<SVGElement>, on: Follow) {
    if (editable === false || isPress(e) === false) return;
    e.stopPropagation();
    const el = e.currentTarget; // React drops `currentTarget` once the handler returns
    const svg = el.ownerSVGElement;
    if (svg === null) return;
    el.setPointerCapture(e.pointerId);
    onPressing(true);
    const start = toMap(svg, e.clientX, e.clientY);
    let travel = 0;
    const onMove = (ev: PointerEvent) => {
      const at = toMap(svg, ev.clientX, ev.clientY);
      travel = Math.max(travel, Math.hypot(at.x - start.x, at.y - start.y));
      on.move(at.x - start.x, at.y - start.y, stepOf(ev, false));
    };
    const onEnd = (commit: boolean) => () => {
      for (const [type, fn] of listeners) el.removeEventListener(type, fn);
      onPressing(false);
      on.end(commit, travel >= dragThreshold);
    };
    // lost capture, e.g. the window lost focus mid-drag
    const listeners = [
      ["pointermove", onMove],
      ["pointerup", onEnd(true)],
      ["pointercancel", onEnd(false)],
      ["lostpointercapture", onEnd(false)],
    ] as [string, EventListener][];
    for (const [type, fn] of listeners) el.addEventListener(type, fn);
  }

  function onNodePointerDown(e: React.PointerEvent<SVGGElement>, id: string) {
    const svg = e.currentTarget.ownerSVGElement;
    const from = pointOf.get(id);
    if (svg === null || from === undefined) return;
    let to = from;
    follow(e, {
      move(dx, dy, step) {
        to = [snap(from[0] + dx, step), snap(from[1] + dy, step)];
        place(svg, id, to, true);
      },
      end(commit, dragged) {
        place(svg, id, from, false); // React redraws it where it ends
        if (commit === false) return;
        if (dragged === false) return connecting !== null ? onConnect(id) : onSelect({ node: id });
        const at = snapped(w, { x: to[0], y: to[1] });
        if (at !== null) onCommit(movedNodes(graph, { [id]: at }));
      },
    });
  }

  function onEdgePointerDown(e: React.PointerEvent<SVGLineElement>, i: number) {
    let [dx, dy] = [0, 0];
    follow(e, {
      move(x, y, step) {
        [dx, dy] = [snap(x, step), snap(y, step)];
        ref.current?.setAttribute("transform", `translate(${dx} ${dy})`);
      },
      end(commit, dragged) {
        ref.current?.removeAttribute("transform"); // React redraws it where it ends
        if (commit === false) return;
        if (dragged === false) return onSelect({ edge: i });
        const to = graph.nodes.map(({ id }) => {
          const [x, y] = pointOf.get(id) as Pt;
          return [id, snapped(w, { x: x + dx, y: y + dy })] as const;
        });
        // all or nothing: one off the navmesh and it springs back
        if (to.every(([, at]) => at !== null))
          onCommit(movedNodes(graph, Object.fromEntries(to) as Record<string, Pt>));
      },
    });
  }

  const selectedNode = selected !== null && "node" in selected ? selected.node : undefined;
  const selectedEdge = selected !== null && "edge" in selected ? selected.edge : undefined;
  const connectFrom = connecting === null ? undefined : pointOf.get(connecting);
  return (
    <g ref={ref} data-graph={graph.key}>
      {graph.edges.map(({ from, to }, i) => {
        const [a, b] = [pointOf.get(from) as Pt, pointOf.get(to) as Pt];
        const angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
        const ink = i === selectedEdge ? inks.selected : inks.graph;
        const ends = {
          "data-graph-a": from,
          "data-graph-b": to,
          x1: a[0],
          y1: a[1],
          x2: b[0],
          y2: b[1],
          vectorEffect: "non-scaling-stroke",
        } as const;
        return (
          <g key={i} pointerEvents={editable ? undefined : "none"}>
            {/* wide and clear, so a press finds the edge: a drag moves the graph, a right click opens the menu */}
            <line
              {...ends}
              data-graph-edge={i}
              data-no-pan={editable ? true : undefined}
              className={editable ? "cursor-move" : undefined}
              onPointerDown={(e) => onEdgePointerDown(e, i)}
              stroke="transparent"
              strokeWidth={12}
            />
            <line {...ends} stroke={ink} strokeWidth={2} pointerEvents="none" />
            {graph.directed && (
              <path
                data-graph-arrow={`${from} ${to}`}
                d="M -0.12 -0.08 L 0.04 0 L -0.12 0.08"
                transform={`translate(${(a[0] + b[0]) / 2} ${(a[1] + b[1]) / 2}) rotate(${angle})`}
                fill="none"
                stroke={ink}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            )}
          </g>
        );
      })}
      {connectFrom !== undefined && (
        <line
          ref={connectLine}
          x1={connectFrom[0]}
          y1={connectFrom[1]}
          x2={connectFrom[0]}
          y2={connectFrom[1]}
          stroke={inks.graph}
          strokeWidth={2}
          strokeDasharray="4 3"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}
      {graph.nodes.map(({ id, spot }) => {
        const [x, y] = pointOf.get(id) as Pt;
        return (
          <g
            key={id}
            data-graph-node={id}
            data-no-pan={editable ? true : undefined}
            transform={`translate(${x} ${y})`}
            className={editable ? (connecting !== null ? "cursor-crosshair" : "cursor-grab") : undefined}
            pointerEvents={editable ? undefined : "none"}
            onPointerDown={(e) => onNodePointerDown(e, id)}
          >
            {spot !== undefined && (
              <circle r={handleRadius * 1.5} fill="none" stroke={inks.graph} strokeWidth={handleRadius * 0.3} />
            )}
            <circle r={handleRadius} fill={id === selectedNode ? inks.selected : inks.graph} />
            <text
              fontSize={handleRadius * 1.1}
              fill={inks.text}
              textAnchor="middle"
              dominantBaseline="central"
              pointerEvents="none"
            >
              {id.replace(/^n/, "")}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Node `id`'s handle at `to`, and the ends of its edges. Their arrows are hidden whilst `dragging` */
function place(svg: SVGSVGElement, id: string, to: Pt, dragging: boolean) {
  const [x, y] = to.map(String);
  svg.querySelector(`[data-graph-node="${id}"]`)?.setAttribute("transform", `translate(${x} ${y})`);
  for (const el of svg.querySelectorAll(`[data-graph-a="${id}"]`)) el.setAttribute("x1", x), el.setAttribute("y1", y);
  for (const el of svg.querySelectorAll(`[data-graph-b="${id}"]`)) el.setAttribute("x2", x), el.setAttribute("y2", y);
  for (const el of svg.querySelectorAll<SVGElement>("[data-graph-arrow]")) {
    const ends = el.getAttribute("data-graph-arrow")?.split(" ") ?? [];
    el.style.visibility = dragging && ends.includes(id) ? "hidden" : "";
  }
}

type Follow = {
  /** By how far from where the press began, and the snap step held */
  move(dx: number, dy: number, step: undefined | number): void;
  /** `commit` unless it was cancelled; `dragged` unless it was a click */
  end(commit: boolean, dragged: boolean): void;
};

type Props = {
  w: WorldState;
  graph: GraphEntry;
  /** Each node's point by id: its spot's, else its own */
  pointOf: Map<string, Pt>;
  /** DEV, where a save reaches the file */
  editable: boolean;
  selected: GraphTarget;
  /** The node an edge is being drawn from */
  connecting: null | string;
  onCommit(next: GraphEntry): void;
  onSelect(target: GraphTarget): void;
  onConnect(to: string): void;
  /** A press began or ended: whilst one is under way the context menu stays shut */
  onPressing(pressing: boolean): void;
};

/** Metres */
const handleRadius = 0.16;
/** In map metres: less is a click */
const dragThreshold = 0.02;
const inks = { graph: "var(--deco-graph)", selected: "var(--deco-graph-selected)", text: "var(--deco-graph-text)" };
