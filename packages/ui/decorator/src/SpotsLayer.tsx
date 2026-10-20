import type { WorldState } from "@npc-cli/ui__world";
import type { Spot, SpotsFile } from "@npc-cli/ui__world/spot.schema";
import { inkOf, type SpotPick } from "./use-spots";

/** Each geomorph's spots, placed by its transform. A press on one chooses it, showing what it sees */
export function SpotsLayer({ w, byGmKey, chosen, onChoose }: Props) {
  return w.gms.map((gm, gmId) => {
    const file = byGmKey[gm.key];
    if (file === undefined) return null;
    const { a, b, c, d, e, f } = gm.transform;
    const spot = chosen?.gmId === gmId ? file.spots[chosen.id] : undefined;
    return (
      <g key={gmId} transform={`matrix(${a},${b},${c},${d},${e},${f})`}>
        {spot !== undefined && <ChosenSpot spot={spot} file={file} />}
        {file.spots.map((s) => (
          <g
            key={s.id}
            data-no-pan
            className="group cursor-pointer"
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              onChoose(chosen?.gmId === gmId && chosen.id === s.id ? null : { gmId, id: s.id });
            }}
          >
            <title>{describe(s)}</title>
            <circle
              cx={s.x}
              cy={s.y}
              r={hitRadius}
              fill={inkOf[s.kind]}
              className="opacity-15 group-hover:opacity-40"
            />
            <circle cx={s.x} cy={s.y} r={dotRadius} fill={inkOf[s.kind]} opacity={spot === undefined ? 0.9 : 0.5} />
            {s.facing !== undefined && (
              <line
                x1={s.x}
                y1={s.y}
                x2={s.x + Math.cos(s.facing) * tickLength}
                y2={s.y + Math.sin(s.facing) * tickLength}
                stroke={inkOf[s.kind]}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
        ))}
      </g>
    );
  });
}

/** What `spot` sees: lines to the spots in sight, dashed through a door, and its depth as a polygon */
function ChosenSpot({ spot, file }: { spot: Spot; file: SpotsFile }) {
  const { x, y } = spot;
  const depth = spot.depth.map((r, k) => {
    const angle = (2 * Math.PI * k) / file.angles;
    return `${x + Math.cos(angle) * r},${y + Math.sin(angle) * r}`;
  });
  const hidden = new Set(spot.crouchHidden);
  return (
    <g pointerEvents="none">
      <polygon
        points={depth.join(" ")}
        fill={ink.depth}
        stroke={ink.line}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {spot.sees.map((id) => (
        <line
          key={id}
          x1={x}
          y1={y}
          x2={file.spots[id].x}
          y2={file.spots[id].y}
          stroke={hidden.has(id) ? ink.hidden : ink.line}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {spot.seesVia.map(([id]) => (
        <line
          key={`via-${id}`}
          x1={x}
          y1={y}
          x2={file.spots[id].x}
          y2={file.spots[id].y}
          stroke={ink.line}
          strokeWidth={1}
          strokeDasharray="3 3"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <circle
        cx={x}
        cy={y}
        r={dotRadius * 2}
        fill="none"
        stroke={inkOf[spot.kind]}
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

function describe(s: Spot) {
  const { doors, decor, doables, obstacles } = s.near;
  return [
    `${s.kind} ${s.id} in room ${s.roomId}`,
    `sees ${s.sees.length}, ${s.seesVia.length} more through a door, doors ${s.seesDoors.join(" ") || "none"}`,
    `near: doors ${doors.join(" ") || "none"}, decor ${decor.length}, doables ${doables.length}, obstacles ${obstacles.length}`,
    ...(s.crouchHidden === undefined ? [] : [`crouched, hidden from ${s.crouchHidden.length}`]),
  ].join("\n");
}

/** Metres */
const dotRadius = 0.06;
/** Metres: the press target, drawn as a faint halo round the dot */
const hitRadius = 0.12;
const tickLength = 0.18;

const ink = {
  depth: "rgba(64, 192, 224, 0.12)",
  line: "rgba(64, 192, 224, 0.6)",
  /** A line its cover hides it from, once crouched */
  hidden: "rgba(240, 80, 80, 0.8)",
};

type Props = {
  w: WorldState;
  byGmKey: Record<string, SpotsFile>;
  chosen: null | SpotPick;
  onChoose(pick: null | SpotPick): void;
};
