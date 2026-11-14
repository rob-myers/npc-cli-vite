import type { WorldState } from "@npc-cli/ui__world";
import type { GraphEdge, GraphEntry, GraphNode } from "@npc-cli/ui__world/scenario.schema";
import { toPrecision } from "@npc-cli/util/legacy/generic";

/** `at` on the navmesh, to the cm, else `null` if none is near */
export function snapped(w: WorldState, at: Geom.VectJson): null | Pt {
  const found = w.npc.getClosestPoly(at, 0.5);
  return found.success ? [toPrecision(found.position[0]), toPrecision(found.position[2])] : null;
}

/** A graph of two nodes joined, on map `mapKey` */
export function newGraph(key: string, mapKey: string, a: Pt, b: Pt): GraphEntry {
  return {
    key,
    name: key.slice("graph/".length),
    kind: "graph",
    mapKey,
    undirected: true,
    meta: {},
    nodes: [
      { id: "n0", at: a, meta: {} },
      { id: "n1", at: b, meta: {} },
    ],
    edges: [{ id: "e0", from: "n0", to: "n1", meta: {} }],
  };
}

/** With each node named in `to` there, off any spot */
export function movedNodes(graph: GraphEntry, to: Record<string, Pt>): GraphEntry {
  const offSpot = ({ spot: _, ...n }: GraphNode, at: Pt): GraphNode => ({ ...n, at });
  return { ...graph, nodes: graph.nodes.map((n) => (n.id in to ? offSpot(n, to[n.id]) : n)) };
}

/** With node `id` on `spot`, at its point */
export function onSpot(graph: GraphEntry, id: string, spot: string, at: Pt): GraphEntry {
  return { ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, at, spot } : n)) };
}

/** With a node at `at`, joined to none */
export function addedNode(graph: GraphEntry, at: Pt): GraphEntry {
  return { ...graph, nodes: [...graph.nodes, { id: nextNodeId(graph), at, meta: {} }] };
}

/** Without node `id` and its edges, keeping `minNodes` */
export function removedNode(graph: GraphEntry, id: string): GraphEntry {
  if (graph.nodes.length <= minNodes) return graph;
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => n.id !== id),
    edges: graph.edges.filter((e) => e.from !== id && e.to !== id),
  };
}

/** With a new edge from `from` to `to`, unless they are one node */
export function addedEdge(graph: GraphEntry, from: string, to: string): GraphEntry {
  if (from === to) return graph;
  return { ...graph, edges: [...graph.edges, { id: nextEdgeId(graph), from, to, meta: {} }] };
}

/** Without edge `id` */
export function removedEdge(graph: GraphEntry, id: string): GraphEntry {
  return { ...graph, edges: graph.edges.filter((e) => e.id !== id) };
}

/** With edge `id` split by a node at `at`, each half keeping its meta */
export function splitEdge(graph: GraphEntry, id: string, at: Pt): GraphEntry {
  const i = graph.edges.findIndex((e) => e.id === id);
  if (i === -1) return graph;
  const { from, to, meta } = graph.edges[i];
  const node = nextNodeId(graph);
  const halves = [
    { id, from, to: node, meta },
    { id: nextEdgeId(graph), from: node, to, meta: { ...meta } },
  ];
  return {
    ...graph,
    nodes: [...graph.nodes, { id: node, at, meta: {} }],
    edges: graph.edges.toSpliced(i, 1, ...halves),
  };
}

/** With edge `id` the other way */
export function reversedEdge(graph: GraphEntry, id: string): GraphEntry {
  return { ...graph, edges: graph.edges.map((e) => (e.id === id ? { ...e, from: e.to, to: e.from } : e)) };
}

export function withUndirected(graph: GraphEntry, undirected: boolean): GraphEntry {
  return { ...graph, undirected };
}

/** With the meta of what `target` names replaced */
export function withMeta(graph: GraphEntry, target: GraphTarget, meta: Record<string, unknown>): GraphEntry {
  if (target === null) return { ...graph, meta };
  if ("node" in target) return { ...graph, nodes: graph.nodes.map((n) => (n.id === target.node ? { ...n, meta } : n)) };
  return { ...graph, edges: graph.edges.map((e) => (e.id === target.edge ? { ...e, meta } : e)) };
}

/** The meta of what `target` names, if it exists */
export function metaOf(graph: GraphEntry, target: GraphTarget): undefined | Record<string, unknown> {
  if (target === null) return graph.meta;
  if ("node" in target) return graph.nodes.find((n) => n.id === target.node)?.meta;
  return graph.edges.find((e) => e.id === target.edge)?.meta;
}

/** The next free node id, e.g. `n4` */
function nextNodeId(graph: GraphEntry) {
  return nextId("n", graph.nodes);
}

/** The next free edge id, e.g. `e4` */
function nextEdgeId(graph: GraphEntry) {
  return nextId("e", graph.edges);
}

function nextId(prefix: string, items: { id: string }[]) {
  const used = items.map(({ id }) => (id.startsWith(prefix) ? Number(id.slice(prefix.length)) : -1));
  return `${prefix}${Math.max(-1, ...used.filter(Number.isInteger)) + 1}`;
}

/** Each edge's bow by id: 0 when alone, else parallel and reverse edges spread to either side */
export function edgeBows(edges: GraphEdge[]): Map<string, number> {
  const byPair = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    const pair = e.from < e.to ? `${e.from} ${e.to}` : `${e.to} ${e.from}`;
    byPair.set(pair, [...(byPair.get(pair) ?? []), e]);
  }
  const bows = new Map<string, number>();
  for (const group of byPair.values()) {
    // one side for the pair, whichever way each edge runs
    group.forEach((e, k) => bows.set(e.id, (k - (group.length - 1) / 2) * (e.from < e.to ? 1 : -1)));
  }
  return bows;
}

/** A curve from `a` to `b` whose middle is `bow` off the straight line: its path, its middle, and its heading there */
export function arc(a: Pt, b: Pt, bow: number) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len = Math.hypot(dx, dy) || 1;
  const [nx, ny] = [-dy / len, dx / len];
  const [mx, my] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const mid: Pt = [mx + nx * bow, my + ny * bow];
  // a quadratic's middle is halfway to its control point
  const d =
    bow === 0
      ? `M ${a[0]} ${a[1]} L ${b[0]} ${b[1]}`
      : `M ${a[0]} ${a[1]} Q ${mx + 2 * nx * bow} ${my + 2 * ny * bow} ${b[0]} ${b[1]}`;
  return { d, mid, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}

/** The graph itself (`null`), a node by id, or an edge by id */
export type GraphTarget = null | { node: string } | { edge: string };

export type Pt = [number, number];

/** A graph keeps this many nodes */
export const minNodes = 1;
