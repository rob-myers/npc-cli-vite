import type { GraphEntry } from "@npc-cli/ui__world/scenario.schema";

/** A graph drawn to scale from its nodes' saved points, as the Decorator's map has it: y down. Arrows if directed */
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

  return (
    <svg viewBox={viewBox.join(" ")} className="w-full max-h-48 text-zinc-400" role="img" aria-label={graph.key}>
      {graph.edges.map(({ from, to }, i) => {
        const [a, b] = [at.get(from), at.get(to)];
        if (a === undefined || b === undefined) return null;
        const angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
        return (
          <g key={i} stroke="currentColor" fill="none" strokeWidth={1.5}>
            <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} vectorEffect="non-scaling-stroke" />
            {graph.directed && (
              <path
                d={`M ${-r} ${-r * 0.7} L ${r * 0.4} 0 L ${-r} ${r * 0.7}`}
                transform={`translate(${(a[0] + b[0]) / 2} ${(a[1] + b[1]) / 2}) rotate(${angle})`}
                vectorEffect="non-scaling-stroke"
              />
            )}
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
