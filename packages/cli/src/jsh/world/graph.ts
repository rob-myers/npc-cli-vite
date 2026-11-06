import {
  edgeKey,
  type GraphEdge,
  type GraphEntry,
  GraphEntrySchema,
  type GraphNode,
} from "@npc-cli/ui__world/scenario.schema";
import { loadScenarioEntries } from "@npc-cli/ui__world/scenario-shared";
import { spotKeyRe } from "@npc-cli/ui__world/spot.schema";
import { toPrecision } from "@npc-cli/util/legacy/generic";
import { spotPoints } from "./perception.main";

/** For `sc` and the behaviours reading graphs, e.g. `act patrol`: kept off the shell as an object — see `docs/npc-graphs.md` */
export const graphs = {
  closedWalk,
  /** A saved graph by `{slug}` or `graph/{slug}`, else a graph value, e.g. `$( sc get … )`: on this map */
  async find(ct: JshCli.RunArg, value: unknown): Promise<GraphEntry> {
    const key = typeof value === "string" ? (value.startsWith("graph/") ? value : `graph/${value}`) : null;
    const entry = key === null ? value : (await loadScenarioEntries())[key];
    if (entry === undefined) throw Error(`not found: ${key}`);
    const graph = GraphEntrySchema.parse(entry);
    if (graph.mapKey !== ct.w.mapKey) throw Error(`${graph.key} is on ${graph.mapKey}`);
    return graph;
  },
  resolve,
  /** Nodes `n0`… at `points`, joined in turn, and back to the first if `cycle` */
  async through(ct: JshCli.RunArg, points: unknown[], cycle: boolean, directed: boolean) {
    const nodes = await toNodes(ct, points);
    return { nodes, edges: edgesThrough(nodes, cycle, directed) };
  },
};

/** Edges through `nodes` in turn, and back to the first if `cycle`, each pair once */
function edgesThrough(nodes: GraphNode[], cycle: boolean, directed: boolean): GraphEdge[] {
  const count = cycle ? nodes.length : nodes.length - 1;
  const byKey = new Map<string, GraphEdge>();
  for (let i = 0; i < count; i++) {
    const [from, to] = [nodes[i].id, nodes[(i + 1) % nodes.length].id];
    const key = edgeKey(from, to, directed);
    if (from !== to && !byKey.has(key)) byKey.set(key, { from, to, meta: {} });
  }
  return [...byKey.values()];
}

/**
 * Node ids walked round and round, crossing every edge: once each if every node is balanced, else there and back.
 * It starts at the first node. A directed graph must be balanced, and any graph connected
 */
function closedWalk(graph: GraphEntry): string[] {
  const { nodes, edges, directed } = graph;
  const [start, name] = [nodes[0].id, graph.key || "graph"];
  /** Each node's edges, by index, both ways */
  const both = new Map(nodes.map((n) => [n.id, [] as Link[]]));
  /** Each node's edges it may take: as `both` unless directed */
  const out = directed ? new Map(nodes.map((n) => [n.id, [] as Link[]])) : both;
  edges.forEach(({ from, to }, e) => {
    both.get(from)?.push({ to, e });
    both.get(to)?.push({ to: from, e });
    if (directed) out.get(from)?.push({ to, e });
  });
  const linksOf = (id: string, of: Map<string, Link[]>) => of.get(id) ?? [];

  const reached = new Set([start]);
  for (const id of reached) for (const { to } of linksOf(id, both)) reached.add(to);
  const apart = nodes.filter((n) => !reached.has(n.id)).map((n) => n.id);
  if (apart.length > 0) throw Error(`${name}: not connected to ${start}: ${apart.join(" ")}`);

  if (edges.length === 0) return [start]; // one node, stood at
  // as many in as out if directed, else an even number
  const balanced = nodes.every(({ id }) =>
    directed ? 2 * linksOf(id, out).length === linksOf(id, both).length : linksOf(id, both).length % 2 === 0,
  );
  const used = new Set<number>();
  if (balanced) {
    // Hierholzer: a circuit using each edge once
    const [stack, circuit, nextLink] = [[start], [] as string[], new Map<string, number>()];
    while (stack.length > 0) {
      const v = stack[stack.length - 1];
      const links = linksOf(v, out);
      let i = nextLink.get(v) ?? 0;
      while (i < links.length && used.has(links[i].e)) i++;
      nextLink.set(v, i);
      if (i === links.length) circuit.push(stack.pop() as string);
      else used.add(links[i].e), stack.push(links[i].to);
    }
    return circuit.reverse().slice(0, -1);
  }
  if (directed) throw Error(`${name}: directed, and no walk crosses each edge once`);

  const [walk, visited] = [[] as string[], new Set<string>()];
  const visit = (v: string) => {
    visited.add(v);
    walk.push(v);
    for (const { to, e } of linksOf(v, out)) {
      if (used.has(e)) continue;
      used.add(e);
      if (visited.has(to)) walk.push(to, v);
      else visit(to), walk.push(v);
    }
  };
  visit(start);
  return walk.slice(0, -1);
}

/** An edge from a node, by its index */
type Link = { to: string; e: number };

/** Each node's floor point by id: its spot's, else `at`, saying so if its spot is gone */
async function resolve(ct: JshCli.RunArg, graph: GraphEntry): Promise<Map<string, Geom.VectJson>> {
  const onSpots = graph.nodes.filter((n) => n.spot !== undefined);
  const points = await spotPoints(
    ct,
    onSpots.map((n) => n.spot as string),
  );
  const spotAt = new Map(onSpots.map((n, i) => [n.id, points[i]]));
  return new Map(
    graph.nodes.map((n) => {
      const at = spotAt.get(n.id);
      if (at === null) ct.api.writeInfo(`${graph.key || "graph"} ${n.id}: no spot ${n.spot}, so at its point`);
      return [n.id, at ?? { x: n.at[0], y: n.at[1] }];
    }),
  );
}

/** Nodes `n0`… on the navmesh, to the cm: from pick events, `[x, y]`, `{ x, y }` or spot keys, which they keep */
async function toNodes(ct: JshCli.RunArg, given: unknown[]): Promise<GraphNode[]> {
  const spotKeys = given.filter((x): x is string => typeof x === "string");
  const bad = spotKeys.find((x) => spotKeyRe.test(x) === false);
  if (bad !== undefined) throw Error(`not a spot: ${bad}`);
  const points = await spotPoints(ct, spotKeys);
  const spotAt = new Map(spotKeys.map((spotKey, i) => [spotKey, points[i]]));
  return given.map((x, i) => {
    const at = typeof x === "string" ? spotAt.get(x) : ct.w.helper.parseGroundPoint(x as JshCli.PointAnyFormat);
    if (at == null) throw Error(`point ${i}: no spot ${x}`);
    const found = ct.w.npc.getClosestPoly(at, 0.5);
    if (found.success === false) throw Error(`point ${i}: off the navmesh`);
    return {
      id: `n${i}`,
      at: [toPrecision(found.position[0]), toPrecision(found.position[2])],
      ...(typeof x === "string" && { spot: x }),
      meta: {},
    };
  });
}
