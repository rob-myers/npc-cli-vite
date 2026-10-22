import type { WorldState } from "@npc-cli/ui__world";
import type { Spot, SpotsFile } from "@npc-cli/ui__world/spot.schema";
import { createSightGrid, rimSamples, visionAt, visionPolygon } from "@npc-cli/ui__world/spot-sight";
import { Poly, Vect } from "@npc-cli/util/geom";
import { useMemo } from "react";
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
        {spot !== undefined && <ChosenSpot spot={spot} file={file} gm={gm} />}
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

/**
 * What `spot`'s region may see: a ring on each spot it may see, green if always, dashed if through doors,
 * red if it is hidden from it crouched. Its region as a circle, with what its samples see, doors open — see `docs/sight.md`
 */
function ChosenSpot({ spot, file, gm }: { spot: Spot; file: SpotsFile; gm: Geomorph.LayoutInstance }) {
  const { x, y } = spot;
  /** Its samples, and what they see, doors open, as one outlined path. Else unoutlined, should the union fail */
  const { samples, seen } = useMemo(() => {
    const grid = sightGridOf(gm);
    const samples = [spot, ...rimSamples(visionAt(grid, gm, spot, file.radius).shut)];
    const polys = samples.map((q) => tidy(visionPolygon(visionAt(grid, gm, q, file.radius).open, file.radius)));
    return { samples, seen: unionPath(polys) };
  }, [spot, gm, file.radius]);
  const hidden = new Set(spot.crouchSafe);
  const ring = (id: number, stroke: string, dashed = false) => (
    <circle
      key={`${stroke}-${id}`}
      cx={file.spots[id].x}
      cy={file.spots[id].y}
      r={dotRadius * 1.6}
      fill="none"
      stroke={hidden.has(id) ? ink.hidden : stroke}
      strokeWidth={1.5}
      strokeDasharray={dashed ? "2 2" : undefined}
      vectorEffect="non-scaling-stroke"
    />
  );
  return (
    <g pointerEvents="none">
      <path
        d={seen.d}
        fill={ink.depth}
        fillRule="nonzero"
        stroke={seen.outlined ? ink.line : "none"}
        strokeOpacity={0.9}
        strokeWidth={1}
        strokeDasharray="4 3"
        vectorEffect="non-scaling-stroke"
      />
      {samples.map((q) => (
        <circle key={`${q.x},${q.y}`} cx={q.x} cy={q.y} r={dotRadius * 0.6} fill={ink.line} />
      ))}
      <circle
        cx={x}
        cy={y}
        r={file.regionRadius}
        fill={ink.region}
        stroke={ink.line}
        strokeWidth={1}
        strokeDasharray="4 2"
        vectorEffect="non-scaling-stroke"
      />
      {spot.always.map((id) => ring(id, ink.always))}
      {spot.sight.map((id) => ring(id, ink.may))}
      {spot.via.flatMap(([, ids]) => ids.map((id) => ring(id, ink.may, true)))}
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

/** Rounded to a millimetre, without repeats: polygon-clipping fails on near-duplicate points */
function tidy(points: Geom.VectJson[]) {
  const tidied: Vect[] = [];
  for (const { x, y } of points) {
    const p = new Vect(Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000);
    const last = tidied[tidied.length - 1];
    if (last === undefined || last.x !== p.x || last.y !== p.y) tidied.push(p);
  }
  if (tidied.length > 1 && tidied[0].equals(tidied[tidied.length - 1])) tidied.pop();
  return tidied;
}

/** Their union as one path, else each as a subpath, filled `nonzero` to look the same */
function unionPath(polys: Vect[][]) {
  try {
    return {
      d: Poly.union(polys.map((points) => new Poly(points)))
        .map((poly) => poly.svgPath)
        .join(" "),
      outlined: true,
    };
  } catch {
    return { d: polys.map((points) => `M${points.map((p) => `${p.x},${p.y}`).join("L")}Z`).join(" "), outlined: false };
  }
}

/** A geomorph's sight occluders, made once per layout */
function sightGridOf(gm: Geomorph.LayoutInstance) {
  let grid = sightGrids.get(gm);
  if (grid === undefined) sightGrids.set(gm, (grid = createSightGrid(gm)));
  return grid;
}

const sightGrids = new WeakMap<Geomorph.LayoutInstance, ReturnType<typeof createSightGrid>>();

function describe(s: Spot) {
  const { doors, decor, doables, obstacles } = s.near;
  return [
    `${s.kind} ${s.id} in room ${s.roomId}`,
    `always sees ${s.always.length}, may see ${s.sight.length}, ${s.via.reduce((n, [, ids]) => n + ids.length, 0)} more through doors`,
    `near: doors ${doors.join(" ") || "none"}, decor ${decor.length}, doables ${doables.length}, obstacles ${obstacles.length}`,
    ...(s.kind === "cover" ? [`crouched, hidden from ${s.crouchSafe.length}`] : []),
  ].join("\n");
}

/** Metres */
const dotRadius = 0.06;
/** Metres: the press target, drawn as a faint halo round the dot */
const hitRadius = 0.12;
const tickLength = 0.18;

const ink = {
  depth: "rgba(64, 192, 224, 0.06)",
  line: "rgba(64, 192, 224, 0.6)",
  region: "rgba(64, 192, 224, 0.08)",
  /** A spot whose region it always sees */
  always: "rgba(96, 220, 120, 0.9)",
  /** A spot whose region it may see */
  may: "rgba(240, 190, 60, 0.9)",
  /** A line its cover hides it from, once crouched */
  hidden: "rgba(240, 80, 80, 0.8)",
};

type Props = {
  w: WorldState;
  byGmKey: Record<string, SpotsFile>;
  chosen: null | SpotPick;
  onChoose(pick: null | SpotPick): void;
};
