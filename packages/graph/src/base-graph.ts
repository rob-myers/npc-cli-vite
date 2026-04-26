import { Vect } from "@npc-cli/util/geom";
import { deepClone, flatten, removeFirst, warn } from "@npc-cli/util/legacy/generic";
import chalk from "chalk";

export class BaseGraph<
  NodeType extends Graph.BaseNode = Graph.BaseNode,
  EdgeOpts extends Graph.BaseEdgeOpts = Graph.BaseEdgeOpts,
> implements Graph.IGraph<NodeType, EdgeOpts>
{
  nodes = new Set<NodeType>();
  succ = new Map<NodeType, Map<NodeType, Graph.Edge<NodeType, EdgeOpts>>>();
  pred = new Map<NodeType, Map<NodeType, Graph.Edge<NodeType, EdgeOpts>>>();
  nodesArray: NodeType[] = [];
  edgesArray: Graph.Edge<NodeType, EdgeOpts>[] = [];
  idToNode = new Map<NodeType["id"], NodeType>();
  idToEdge = new Map<string, Graph.Edge<NodeType, EdgeOpts>>();

  connect(opts: EdgeOpts) {
    const src = this.getNode(opts.src);
    const dst = this.getNode(opts.dst);

    if (src && dst) {
      const edge = this.getEdge(src, dst);
      if (edge) {
        return { edge, isNew: false };
      } else {
        this.registerEdge(opts);
        return { edge, isNew: true };
      }
    }
    console.error("Can't connect nodes:", { src, dst, context: { ...opts, graph: this } });
    return { isNew: false, edge: null };
  }

  disconnect(src: NodeType, dst: NodeType) {
    const edge = this.getEdge(src, dst);
    if (edge) {
      this.removeEdge(edge);
      return true;
    } else {
      console.error("Failed to disconnect", src, dst, "in", this);
    }
    return false;
  }

  disconnectById(edgeid: string) {
    const edge = this.idToEdge.get(edgeid);
    if (edge) {
      return this.disconnect(edge.src, edge.dst);
    } else {
      console.error(`Cannot remove non-existent edge '${edgeid}'.`);
    }
    return false;
  }

  disconnectByIds(srcid: string, dstid: string) {
    const src = this.idToNode.get(srcid);
    const dst = this.idToNode.get(dstid);
    if (src && dst) {
      return this.disconnect(src, dst);
    } else {
      console.error(`Cannot remove edge ('${srcid}' -> '${dstid}') from`, src, "to", dst);
    }
    return false;
  }

  dispose() {
    this.nodes.clear();
    this.succ.clear();
    this.pred.clear();
    this.nodesArray.length = 0;
    this.edgesArray.length = 0;
    this.idToNode.clear();
    this.idToEdge.clear();
  }

  getCoReachableNodes(node: NodeType): NodeType[] {
    const coReachable = new Set([node]);
    let [count, frontier] = [0, [node]];
    while (coReachable.size > count) {
      count = coReachable.size;
      frontier = flatten(frontier.map((node) => this.getPreds(node)));
      frontier.forEach((node) => coReachable.add(node));
    }
    return Array.from(coReachable.values());
  }

  getEdge(src: NodeType, dst: NodeType) {
    const nhood = this.succ.get(src);
    return nhood ? nhood.get(dst) || null : null;
  }

  getEdgesFrom(node: NodeType) {
    const succ = this.succ.get(node);
    return (succ && Array.from(succ.values())) || [];
  }

  getEdgesTo(node: NodeType) {
    const pred = this.pred.get(node);
    return (pred && Array.from(pred.values())) || [];
  }

  getEdgeById(id: string) {
    return this.idToEdge.get(id) || null;
  }

  getGraphviz(graphName = "graph1", edgeLabel: (edge: Graph.Edge<NodeType, EdgeOpts>) => string | null = () => null) {
    return `
digraph ${graphName} {

${this.nodesArray.map((x) => `  "${x.id}"\n`).join("")}

${this.edgesArray.map((x) => `  "${x.src.id}" -> "${x.dst.id}" ${edgeLabel(x) || ""}\n`).join("")}

}`;
  }

  getNode(id: NodeType["id"]) {
    return this.idToNode.get(id) || null;
  }

  getParent(node: NodeType) {
    const preds = this.getPreds(node);
    return preds.length === 1 ? preds[0] : null;
  }

  getPreds(node: NodeType) {
    const pred = this.pred.get(node);
    return (pred && Array.from(pred.keys())) || [];
  }

  getReachableNodes(node: NodeType | string): NodeType[] {
    node = typeof node === "string" ? (this.getNode(node) as NodeType) : node;
    const reachable = new Set([node]);
    let [count, frontier] = [0, [node]];
    while (reachable.size > count) {
      count = reachable.size;
      frontier = flatten(frontier.map((node) => this.getSuccs(node)));
      frontier.forEach((node) => reachable.add(node));
    }
    return Array.from(reachable.values());
  }

  getReachableUpTo(node: NodeType | string, stopWhen: (node: NodeType, depth: number) => boolean): NodeType[] {
    const root = typeof node === "string" ? (this.getNode(node) as NodeType) : node;
    const reachable = new Set([root]);
    let [total, frontier, depth] = [0, [root], 0];
    while (reachable.size > total) {
      total = reachable.size;
      frontier = flatten(frontier.map((node) => (stopWhen(node, depth) ? [] : this.getSuccs(node))));
      frontier.forEach((node) => reachable.add(node));
      depth++;
    }
    return Array.from(reachable.values());
  }

  getSuccs(node: NodeType) {
    const succ = this.succ.get(node);
    return (succ && Array.from(succ.keys())) || [];
  }

  hasNode(node: NodeType) {
    return this.nodes.has(node);
  }

  isConnected(src: NodeType, dst: NodeType) {
    const succ = this.succ.get(src);
    return succ?.has(dst) || false;
  }

  nodeHasPred(node: NodeType) {
    const pred = this.pred.get(node);
    return (pred && pred.size > 0) || false;
  }

  nodeHasSucc(node: NodeType) {
    const succ = this.succ.get(node);
    return (succ && succ.size > 0) || false;
  }

  plainFrom(json: Graph.GraphJson<NodeType, EdgeOpts>): this {
    const nodes = json.nodes.map(deepClone);
    this.registerNodes(nodes);
    json.edges.forEach((def) => this.registerEdge(def));
    return this;
  }

  plainJson(): Graph.GraphJson<NodeType, EdgeOpts> {
    return {
      nodes: this.nodesArray.map(deepClone),
      edges: this.edgesArray.map(
        (edge) => deepClone({ ...edge, id: edge.id, src: edge.src.id, dst: edge.dst.id }) as unknown as EdgeOpts,
      ),
    };
  }

  protected registerNode(node: NodeType) {
    this.nodes.add(node);
    this.nodesArray.push(node);
    this.succ.set(node, new Map());
    this.pred.set(node, new Map());
    this.idToNode.set(node.id, node);
  }

  protected registerNodes(nodes: NodeType[]) {
    nodes.forEach((node) => {
      this.nodes.add(node);
      this.succ.set(node, new Map());
      this.pred.set(node, new Map());
      this.idToNode.set(node.id, node);
    });
    this.nodesArray.push(...nodes);
  }

  protected registerEdge(def: EdgeOpts) {
    const [src, dst] = [this.getNode(def.src), this.getNode(def.dst)];
    if (src && dst) {
      const edge: Graph.Edge<NodeType, EdgeOpts> = { ...def, src, dst, id: `${def.src}->${def.dst}` };
      const succ = this.succ.get(src) as Map<NodeType, Graph.Edge<NodeType, EdgeOpts>>;
      const pred = this.pred.get(dst) as Map<NodeType, Graph.Edge<NodeType, EdgeOpts>>;
      succ.set(dst, edge);
      pred.set(src, edge);
      this.idToEdge.set(edge.id, edge);
      this.edgesArray.push(edge);
    } else {
      console.warn(chalk.red("error adding edge"), chalk.yellow(JSON.stringify(def)));
    }
  }

  removeEdge(edge: Graph.Edge<NodeType, EdgeOpts> | null) {
    if (edge) {
      const succ = this.succ.get(edge.src);
      if (succ) succ.delete(edge.dst);
      const pred = this.pred.get(edge.dst);
      if (pred) pred.delete(edge.src);
      this.idToEdge.delete(edge.id);
      removeFirst(this.edgesArray, edge);
    }
  }

  removeNode(node: NodeType) {
    if (this.nodes.has(node)) {
      this.nodes.delete(node);
      removeFirst(this.nodesArray, node);
      this.idToNode.delete(node.id);
      this.getPreds(node).forEach((other) => this.removeEdge(this.getEdge(other, node)));
      this.getSuccs(node).forEach((other) => this.removeEdge(this.getEdge(node, other)));
      this.succ.delete(node);
      this.pred.delete(node);
      return true;
    }
    return false;
  }

  removeNodeById(id: string) {
    const node = this.idToNode.get(id);
    if (node) {
      return this.removeNode(node);
    }
    return false;
  }

  reset() {
    this.nodes.clear();
    this.succ.clear();
    this.pred.clear();
    this.nodesArray = [];
    this.edgesArray = [];
    this.idToNode.clear();
    this.idToEdge.clear();
  }

  stratify(): NodeType[][] {
    let frontier: NodeType[] = [];
    let unseen = this.nodesArray.slice();
    const seen = new Set<NodeType>();
    const output: NodeType[][] = [];

    while (
      ((frontier = []),
      (unseen = unseen.filter((x) => {
        if (this.getSuccs(x).every((y) => seen.has(y))) {
          frontier.push(x);
        } else {
          return true;
        }
      })),
      frontier.map((x) => seen.add(x)).length && output.push(frontier))
    );

    unseen.length && warn(`stratify: ignoring ${unseen.length} nodes`);
    return output;
  }
}

export function createBaseAstar(partial: Partial<Graph.AStarNode["astar"]>): Graph.AStarNode {
  return {
    astar: {
      cost: 1,
      visited: false,
      closed: false,
      parent: null,
      neighbours: [],
      centroid: partial.centroid || Vect.zero,
      ...partial,
    },
  };
}
