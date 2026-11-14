import type { GraphEntry } from "@npc-cli/ui__world/scenario.schema";
import { arc, edgeBows } from "./graph-edit";

/** A graph drawn to scale from its nodes' saved points, as the Decorator's map has it: y down. Arrowed, faint if undirected */
export function GraphShape({ graph }: { graph: GraphEntry }) {
  const at = new Map(graph.nodes.map((n) => [n.id, n.at]));
  const xs = graph.nodes.map((n) => n.at[0]);
  const ys = graph.nodes.map((n) => n.at[1]);
  const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
  const size = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY, minSize);
  /** Node radius, so the drawing reads the same at any size */
  const r = size * 0.06;
  const pad = r * 3;
  const viewBox = [minX - pad, minY - pad, Math.max(...xs) - minX + 2 * pad, Math.max(...ys) - minY + 2 * pad];
  const bows = edgeBows(graph.edges);

  return (
    <svg viewBox={viewBox.join(" ")} className="w-full max-h-48 text-zinc-400" role="img" aria-label={graph.key}>
      {graph.edges.map(({ id, from, to }) => {
        const [a, b] = [at.get(from), at.get(to)];
        if (a === undefined || b === undefined) return null;
        const { d, mid, angle } = arc(a, b, (bows.get(id) ?? 0) * r * 2.5);
        return (
          <g key={id} stroke="currentColor" fill="none" strokeWidth={1.5}>
            <path d={d} vectorEffect="non-scaling-stroke" />
            <path
              d={`M ${-r} ${-r * 0.7} L ${r * 0.4} 0 L ${-r} ${r * 0.7}`}
              transform={`translate(${mid[0]} ${mid[1]}) rotate(${angle})`}
              opacity={graph.undirected ? 0.4 : undefined}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
      {graph.nodes.map(({ id, at: [x, y], spot }) => (
        <g key={id} transform={`translate(${x} ${y})`}>
          {spot !== undefined && (
            <circle r={r * 1.5} fill="none" stroke="currentColor" strokeWidth={r * 0.25} className="text-zinc-500" />
          )}
          <circle r={r} className="fill-zinc-200" />
          <text fontSize={r * 1.1} textAnchor="middle" dominantBaseline="central" className="fill-zinc-900">
            {id.replace(/^n/, "")}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Metres: the least extent drawn, so one node or a short edge is not huge */
const minSize = 2;
