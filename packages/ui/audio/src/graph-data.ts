import type { AmbienceKey } from "./ambience";

export type GraphGroup = "drone" | "air" | "choir" | "master";

/** A channel's colour, on the desk and on the diagram */
export const graphColours: Record<GraphGroup, string> = {
  drone: "#f59e0b",
  air: "#38bdf8",
  choir: "#a78bfa",
  master: "#f87171",
};

export type GraphNode = {
  id: string;
  label: string;
  /** Its column and row on the diagram's grid */
  at: [number, number];
  group: GraphGroup;
  /** The settings it takes, whose values it shows */
  keys?: AmbienceKey[];
  /** What it shows otherwise */
  note?: string;
};

/** `mod` ones drive a parameter of their target, where the rest carry sound into it */
export type GraphEdge = { from: string; to: string; mod?: true };

/** The engine's nodes as `createAmbience` connects them. Keep the two in step */
export const graphNodes: GraphNode[] = [
  { id: "saw1", label: "saw", at: [0, 0], group: "drone", keys: ["droneHz"] },
  { id: "saw2", label: "saw", at: [0, 1], group: "drone", note: "+9 cents" },
  { id: "sine", label: "sine", at: [0, 2], group: "drone", note: "octave up" },
  { id: "rumbleLow", label: "lowpass", at: [1, 3], group: "drone", note: "70 Hz" },
  { id: "rumbleGain", label: "gain", at: [2, 3], group: "drone", note: "x2" },
  { id: "lfoDrone", label: "lfo", at: [3, 0], group: "drone", note: "0.06 Hz" },
  { id: "droneMix", label: "mix", at: [3, 1], group: "drone", note: "x0.3" },
  { id: "droneLow", label: "lowpass", at: [4, 1], group: "drone", keys: ["droneCutoff"] },
  { id: "droneOut", label: "engine level", at: [5, 1], group: "drone", keys: ["drone"] },
  { id: "droneSend", label: "send", at: [5, 2], group: "drone", note: "x0.15" },

  { id: "noise", label: "pink noise", at: [0, 4], group: "air", note: "looped" },
  { id: "airBand", label: "bandpass", at: [1, 5], group: "air", keys: ["airHz"] },
  { id: "lfoAirHz", label: "lfo", at: [1, 6], group: "air", note: "0.031 Hz" },
  { id: "airMix", label: "mix", at: [3, 5], group: "air", note: "x0.9" },
  { id: "lfoAir", label: "lfo", at: [3, 6], group: "air", note: "0.05 Hz" },
  { id: "airOut", label: "air level", at: [5, 5], group: "air", keys: ["air"] },
  { id: "airSend", label: "send", at: [5, 6], group: "air", note: "x0.2" },

  { id: "sample", label: "sample", at: [0, 8], group: "choir", keys: ["choirTranspose", "choirDetune"] },
  { id: "grainFade", label: "stretch fade", at: [1, 8], group: "choir", keys: ["grain", "crossfade"] },
  { id: "noteEnv", label: "note envelope", at: [2, 8], group: "choir", keys: ["attack", "release"] },
  { id: "pan", label: "pan", at: [3, 8], group: "choir", keys: ["spread"] },
  { id: "choirLow", label: "lowpass", at: [4, 8], group: "choir", keys: ["choirCutoff"] },
  { id: "choirOut", label: "choir level", at: [5, 8], group: "choir", keys: ["choir"] },
  { id: "choirDry", label: "dry", at: [6, 8], group: "choir", keys: ["choirDry"] },

  { id: "reverb", label: "convolver", at: [6, 9.5], group: "master", note: "6 s hall" },
  { id: "wet", label: "reverb level", at: [7, 9.5], group: "master", keys: ["reverb"] },
  { id: "master", label: "master level", at: [8, 4], group: "master", keys: ["master"] },
  { id: "limiter", label: "limiter", at: [8, 5], group: "master", note: "compressor" },
  { id: "analyser", label: "analyser", at: [8, 6], group: "master", note: "spectrum" },
  { id: "out", label: "speakers", at: [8, 7], group: "master" },
];

export const graphEdges: GraphEdge[] = [
  { from: "saw1", to: "droneMix" },
  { from: "saw2", to: "droneMix" },
  { from: "sine", to: "droneMix" },
  { from: "noise", to: "rumbleLow" },
  { from: "rumbleLow", to: "rumbleGain" },
  { from: "rumbleGain", to: "droneMix" },
  { from: "lfoDrone", to: "droneMix", mod: true },
  { from: "droneMix", to: "droneLow" },
  { from: "droneLow", to: "droneOut" },
  { from: "droneOut", to: "master" },
  { from: "droneOut", to: "droneSend" },
  { from: "droneSend", to: "reverb" },

  { from: "noise", to: "airBand" },
  { from: "lfoAirHz", to: "airBand", mod: true },
  { from: "airBand", to: "airMix" },
  { from: "lfoAir", to: "airMix", mod: true },
  { from: "airMix", to: "airOut" },
  { from: "airOut", to: "master" },
  { from: "airOut", to: "airSend" },
  { from: "airSend", to: "reverb" },

  { from: "sample", to: "grainFade" },
  { from: "grainFade", to: "noteEnv" },
  { from: "noteEnv", to: "pan" },
  { from: "pan", to: "choirLow" },
  { from: "choirLow", to: "choirOut" },
  { from: "choirOut", to: "choirDry" },
  { from: "choirDry", to: "master" },
  { from: "choirOut", to: "reverb" },

  { from: "reverb", to: "wet" },
  { from: "wet", to: "master" },
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
