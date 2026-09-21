import { type Route, type RouteStep, routes } from "@npc-cli/cli/jsh/world/route";
import { routeStepIcon } from "@npc-cli/cli/jsh/world/route-icons";
import type { WorldState } from "@npc-cli/ui__world";
import { trackId } from "./schema";

/**
 * The routes of the map, over `NavMap2d`. A point with something done there is a STOP — a numbered
 * disc with a badge per step — and any other a pass-through, a small dot. Legs are straight: they
 * show the order of the points, not the journey an agent would take between them
 */
export function NavRoutesLayer({ w, all, hidden, selected }: Props) {
  return Object.entries(all).flatMap(([name, def]) =>
    Object.entries(def.tracks).map(([role, steps], trackIndex) => {
      const id = trackId(name, role);
      if (hidden.includes(id)) return null;
      const color = routes.colorOf(trackIndex);
      const points = getPoints(w, steps);
      const isSelected = id === selected;
      return (
        <g key={id} opacity={selected === null || isSelected ? 1 : 0.45}>
          {points.slice(1).map((p, i) => (
            <Leg key={p.index} from={points[i].at} to={p.at} color={color} bold={isSelected} />
          ))}
          {points.map((p, order) => (
            <Point key={p.index} point={p} order={order + 1} color={color} label={`${name} / ${role}`} />
          ))}
        </g>
      );
    }),
  );
}

function Leg({ from, to, color, bold }: { from: Geom.VectJson; to: Geom.VectJson; color: string; bold: boolean }) {
  const [dx, dy] = [to.x - from.x, to.y - from.y];
  const degrees = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (
    <g pointerEvents="none">
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        stroke={color}
        strokeWidth={bold ? 2.5 : 1.5}
        strokeOpacity={0.8}
        vectorEffect="non-scaling-stroke"
      />
      {/* which way, halfway along — too short a leg has no room for one */}
      {Math.hypot(dx, dy) > arrowMinLeg && (
        <polygon
          points={arrowPoints}
          fill={color}
          transform={`translate(${from.x + dx / 2} ${from.y + dy / 2}) rotate(${degrees})`}
        />
      )}
    </g>
  );
}

function Point({ point, order, color, label }: { point: RoutePoint; order: number; color: string; label: string }) {
  const { at, stop, then, problem } = point;
  const r = stop ? stopRadius : passRadius;
  return (
    <g transform={`translate(${at.x} ${at.y})`}>
      <title>{[`${label} #${order}`, ...then.map(describe), problem ?? []].flat().join("\n")}</title>
      {problem !== null && (
        <circle
          r={r + 0.09}
          fill="none"
          stroke={problemInk}
          strokeWidth={2}
          strokeDasharray="3 2"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <circle r={r} fill={color} stroke="#0b1220" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {stop && (
        <text fontSize={0.22} fontWeight={700} textAnchor="middle" dominantBaseline="central" fill="#0b1220">
          {order}
        </text>
      )}
      {then.map((step, i) => {
        const StepIcon = routeStepIcon[step.kind];
        return (
          <StepIcon
            key={i}
            x={stopRadius + 0.06 + i * badgeSize}
            y={-badgeSize / 2}
            width={badgeSize}
            height={badgeSize}
            color={color}
            weight="fill"
          />
        );
      })}
    </g>
  );
}

/** A track's points in order, each with the steps done there and anything wrong with it */
function getPoints(w: WorldState, steps: RouteStep[]): RoutePoint[] {
  const groups = routes.groupByWaypoint(steps).filter((group) => group.length > 0);
  return groups.flatMap((group, i) => {
    const [index, step] = group[0];
    const at = step.kind === "move" ? step.at : step.kind === "do" ? decorPoint(w, step.decorKey) : null;
    if (at === null) return []; // steps done before setting off, or a doable that has gone
    const then = group.slice(1).map(([, s]) => s);
    // the last point is arrived at too, whatever follows it
    const stop = then.length > 0 || step.kind === "do" || i === groups.length - 1;
    return { index, at, stop, then, problem: step.kind === "move" ? problemOf(w, step) : null };
  });
}

function decorPoint(w: WorldState, decorKey: string): Geom.VectJson | null {
  const d = w.decor?.byKey[decorKey];
  return d?.type === "point" ? { x: d.x, y: d.y } : null;
}

/** A nav point must be on the navmesh — `move` throws otherwise — and in the room it says it is */
function problemOf(w: WorldState, step: Extract<RouteStep, { kind: "move" }>): string | null {
  if (w.npc?.getClosestPoly(step.at, 0.5).success !== true) return "off the navmesh";
  const grKey = w.e.findRoomContaining(step.at)?.grKey ?? null;
  return grKey === step.grKey ? null : `was in ${step.grKey}, now ${grKey ?? "no room"}`;
}

function describe(step: RouteStep): string {
  const { kind, ...rest } = step;
  return `${kind} ${Object.values(rest)
    .map((v) => (typeof v === "object" ? "" : String(v)))
    .join(" ")}`.trim();
}

type RoutePoint = {
  /** Of its `move` or `do` within the track's steps */
  index: number;
  at: Geom.VectJson;
  stop: boolean;
  /** The steps done there */
  then: RouteStep[];
  problem: string | null;
};

type Props = {
  w: WorldState;
  all: Record<string, Route>;
  hidden: string[];
  selected: string | null;
};

// world metres
const stopRadius = 0.2;
const passRadius = 0.08;
const badgeSize = 0.26;
const arrowMinLeg = 0.6;
const arrowPoints = "-0.1,-0.08 0.1,0 -0.1,0.08";
const problemInk = "#f87171";
