import type { WorldState } from "@npc-cli/ui__world";
import { edgeKey, type GraphEntry, type GraphNode } from "@npc-cli/ui__world/scenario.schema";
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
    directed: false,
    meta: {},
    nodes: [
      { id: "n0", at: a, meta: {} },
      { id: "n1", at: b, meta: {} },
    ],
    edges: [{ from: "n0", to: "n1", meta: {} }],
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

/** With `from` joined to `to`, unless they are one or already joined */
export function addedEdge(graph: GraphEntry, from: string, to: string): GraphEntry {
  if (from === to || hasEdge(graph, from, to)) return graph;
  return { ...graph, edges: [...graph.edges, { from, to, meta: {} }] };
}

/** Without edge `i` */
export function removedEdge(graph: GraphEntry, i: number): GraphEntry {
  return { ...graph, edges: graph.edges.toSpliced(i, 1) };
}

/** With edge `i` split by a node at `at`, each half keeping its meta */
export function splitEdge(graph: GraphEntry, i: number, at: Pt): GraphEntry {
  const { from, to, meta } = graph.edges[i];
  const id = nextNodeId(graph);
  return {
    ...graph,
    nodes: [...graph.nodes, { id, at, meta: {} }],
    edges: graph.edges.toSpliced(i, 1, { from, to: id, meta }, { from: id, to, meta: { ...meta } }),
  };
}

/** With edge `i` the other way, unless that edge exists */
export function reversedEdge(graph: GraphEntry, i: number): GraphEntry {
  const { from, to, meta } = graph.edges[i];
  if (hasEdge(graph, to, from)) return graph;
  return { ...graph, edges: graph.edges.toSpliced(i, 1, { from: to, to: from, meta }) };
}

/** With directed set, keeping one edge of any pair made one by it */
export function withDirected(graph: GraphEntry, directed: boolean): GraphEntry {
  if (directed) return { ...graph, directed };
  const seen = new Set<string>();
  const edges = graph.edges.filter(({ from, to }) => {
    const key = edgeKey(from, to, false);
    return seen.has(key) ? false : (seen.add(key), true);
  });
  return { ...graph, directed, edges };
}

/** With the meta of what `target` names replaced */
export function withMeta(graph: GraphEntry, target: GraphTarget, meta: Record<string, unknown>): GraphEntry {
  if (target === null) return { ...graph, meta };
  if ("node" in target) return { ...graph, nodes: graph.nodes.map((n) => (n.id === target.node ? { ...n, meta } : n)) };
  return { ...graph, edges: graph.edges.map((e, i) => (i === target.edge ? { ...e, meta } : e)) };
}

/** The meta of what `target` names, if it exists */
export function metaOf(graph: GraphEntry, target: GraphTarget): undefined | Record<string, unknown> {
  if (target === null) return graph.meta;
  if ("node" in target) return graph.nodes.find((n) => n.id === target.node)?.meta;
  return graph.edges[target.edge]?.meta;
}

/** The next free id, e.g. `n4` */
function nextNodeId(graph: GraphEntry) {
  const used = graph.nodes.map((n) => Number(n.id.match(/^n(\d+)$/)?.[1] ?? -1));
  return `n${Math.max(-1, ...used) + 1}`;
}

function hasEdge(graph: GraphEntry, from: string, to: string) {
  const key = edgeKey(from, to, graph.directed);
  return graph.edges.some((e) => edgeKey(e.from, e.to, graph.directed) === key);
}

/** The graph itself (`null`), a node by id, or an edge by index */
export type GraphTarget = null | { node: string } | { edge: number };

export type Pt = [number, number];

/** A graph keeps this many nodes */
export const minNodes = 1;
