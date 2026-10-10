import { type AmbienceConfig, ambienceUnits } from "./ambience";
import {
  graphBox,
  graphColours,
  graphCorner,
  graphEdgePath,
  graphEdges,
  graphGroupOf,
  graphNodes,
  graphSize,
} from "./graph-data";

/** How the engine's nodes are connected, sound flowing left to right. Dashes move whilst it plays */
export function Graph({ config, playing }: { config: AmbienceConfig; playing: boolean }) {
  return (
    <svg
      width={graphSize.width}
      height={graphSize.height}
      viewBox={`0 0 ${graphSize.width} ${graphSize.height}`}
      className="m-auto shrink-0"
      role="img"
      aria-label="how the ambience's audio nodes are connected"
    >
      <defs>
        {Object.entries(graphColours).map(([group, colour]) => (
          <marker
            key={group}
            id={`audio-graph-arrow-${group}`}
            viewBox="0 0 6 6"
            refX={5.5}
            refY={3}
            markerWidth={5}
            markerHeight={5}
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6 z" fill={colour} />
          </marker>
        ))}
      </defs>
      <style>{"@keyframes audio-graph-flow { to { stroke-dashoffset: -16 } }"}</style>

      {graphEdges.map((edge) => {
        const group = graphGroupOf(edge.from);
        return (
          <path
            key={`${edge.from} ${edge.to}`}
            d={graphEdgePath(edge)}
            fill="none"
            stroke={graphColours[group]}
            strokeWidth={1.5}
            strokeOpacity={edge.mod ? 0.5 : 0.8}
            strokeDasharray={edge.mod ? "2 3" : playing ? "5 3" : undefined}
            markerEnd={`url(#audio-graph-arrow-${group})`}
            style={playing && !edge.mod ? { animation: "audio-graph-flow 0.9s linear infinite" } : undefined}
          />
        );
      })}

      {graphNodes.map((node) => {
        const { x, y } = graphCorner(node);
        const detail = node.keys?.map((key) => `${config[key]}${ambienceUnits[key] ?? ""}`).join("  ") ?? node.note;
        return (
          <g key={node.id}>
            {node.keys && <title>{node.keys.join(", ")}</title>}
            <rect {...graphBox} x={x} y={y} rx={4} fill="#27272a" stroke={graphColours[node.group]} />
            <text
              x={x + graphBox.width / 2}
              y={y + (detail ? 13 : 20)}
              className="fill-zinc-200 text-[10px]"
              textAnchor="middle"
            >
              {node.label}
            </text>
            <text
              x={x + graphBox.width / 2}
              y={y + 25}
              className={node.keys ? "fill-zinc-100 font-mono text-[9px]" : "fill-zinc-500 text-[9px]"}
              textAnchor="middle"
            >
              {detail}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
