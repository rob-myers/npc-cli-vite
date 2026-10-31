import type { AudioKey } from "./steps";

export type GraphGroup = "steps" | "style" | "fx" | "master";

/** A channel's colour, on the desk and on the diagram */
export const graphColours: Record<GraphGroup, string> = {
  steps: "#f59e0b",
  style: "#a78bfa",
  fx: "#5eead4",
  master: "#f87171",
};

export type GraphNode = {
  id: string;
  label: string;
  /** Its column and row on the diagram's grid */
  at: [number, number];
  group: GraphGroup;
  /** The settings it takes, whose values it shows */
  keys?: AudioKey[];
  /** What it shows otherwise */
  note?: string;
};

/** `mod` ones drive a parameter of their target, where the rest carry sound into it */
export type GraphEdge = { from: string; to: string; mod?: true };

/** The engine's nodes as `engine.ts`, `steps.ts` and `sfx.ts` connect them. Keep them in step */
export const graphNodes: GraphNode[] = [
  { id: "feet", label: "footfalls", at: [0, 0.5], group: "style", note: "the player's and npcs' near" },
  { id: "style", label: "kind, level", at: [1, 0.5], group: "style", note: "by their gait" },
  { id: "step", label: "step sample", at: [2, 0.5], group: "steps", note: "level" },
  { id: "side", label: "pan", at: [3, 0.5], group: "steps", note: "by its foot" },
  { id: "stepsOut", label: "steps level", at: [5, 0.5], group: "steps", keys: ["steps"] },

  { id: "sfx", label: "sound effect", at: [2, 2.5], group: "fx", note: "synthesised" },
  { id: "sfxPan", label: "pan", at: [3, 2.5], group: "fx", note: "by its npc" },
  { id: "fxOut", label: "fx level", at: [4, 2.5], group: "fx", keys: ["fx"] },

  { id: "master", label: "master level", at: [8, 0.5], group: "master", keys: ["master"] },
  { id: "limiter", label: "limiter", at: [9, 0.5], group: "master", note: "peaks over -6 dB" },
  { id: "analyser", label: "analyser", at: [9, 1.5], group: "master", note: "spectrum" },
  { id: "out", label: "speakers", at: [9, 2.5], group: "master" },
];

export const graphEdges: GraphEdge[] = [
  { from: "feet", to: "style", mod: true },
  { from: "style", to: "step", mod: true },
  { from: "step", to: "side" },
  { from: "side", to: "stepsOut" },
  { from: "stepsOut", to: "master" },

  { from: "sfx", to: "sfxPan" },
  { from: "sfxPan", to: "fxOut" },
  { from: "fxOut", to: "master" },

  { from: "master", to: "limiter" },
  { from: "limiter", to: "analyser" },
  { from: "analyser", to: "out" },
];

export const graphBox = { width: 86, height: 32 };
const pitch = { x: 114, y: 44 };
const margin = 12;

export const graphSize = {
  width: margin * 2 + graphBox.width + pitch.x * Math.max(...graphNodes.map((node) => node.at[0])),
  height: margin * 2 + graphBox.height + pitch.y * Math.max(...graphNodes.map((node) => node.at[1])),
};

/** A node's top left corner */
export function graphCorner({ at }: GraphNode) {
  return { x: margin + at[0] * pitch.x, y: margin + at[1] * pitch.y };
}

const byId = Object.fromEntries(graphNodes.map((node) => [node.id, node]));

export const graphGroupOf = (id: string) => byId[id].group;

/** An edge's curve: straight down a column, else out of one side and into the other */
export function graphEdgePath({ from, to }: GraphEdge) {
  const a = graphCorner(byId[from]);
  const b = graphCorner(byId[to]);
  const { width, height } = graphBox;
  if (byId[from].at[0] === byId[to].at[0]) {
    const down = b.y > a.y;
    return `M${a.x + width / 2},${a.y + (down ? height : 0)} L${b.x + width / 2},${b.y + (down ? 0 : height)}`;
  }
  const [x1, y1, x2, y2] = [a.x + width, a.y + height / 2, b.x, b.y + height / 2];
  const bend = (x2 - x1) / 2;
  return `M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`;
}
