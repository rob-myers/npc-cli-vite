import { Vect } from "@npc-cli/util/geom";
import { deepClone, flatten, removeFirst, warn } from "@npc-cli/util/legacy/generic";
import chalk from "chalk";

/**
 * ⚠️ tsgo does not support class-level _@typedef_ so manually changed Edge -> Graph.Edge<NodeType, EdgeOpts>
 *
 * @template {Graph.BaseNode} [NodeType=Graph.BaseNode]
 * @template {Graph.BaseEdgeOpts} [EdgeOpts=Graph.BaseEdgeOpts]
 * @implements {Graph.IGraph<NodeType, EdgeOpts>}
 */
export class BaseGraph {
  /**
   * Set of nodes.
   * @type {Set<NodeType>}
   */
  nodes;
  /**
   * Edge representation:
   * succ.get(a).get(b) exists iff a -> b.
   * @type {Map<NodeType, Map<NodeType, Graph.Edge<NodeType, EdgeOpts>>>}
   */
  succ;
  /**
   * Reverse edge representation:
   * pred.get(a).get(b) exists iff b -> a.
   * @type {Map<NodeType, Map<NodeType, Graph.Edge<NodeType, EdgeOpts>>>}
   */
  pred;
  /**
   * Nodes as an array (useful degeneracy)
   * @type {NodeType[]}
   */
  nodesArray;
  /**
   * Edges as an array (useful degeneracy).
   * @type {Graph.Edge<NodeType, EdgeOpts>[]}
   */
  edgesArray;
  /**
   * Node lookup by `node.id`.
   * @type {Map<NodeType['id'], NodeType>}
   */
  idToNode;
  /**
   * Edge lookup by `edge.id`.
   * @type {Map<string, Graph.Edge<NodeType, EdgeOpts>>}
   */
  idToEdge;

  constructor() {
    this.nodes = new Set();
    this.succ = new Map();
    this.pred = new Map();
    this.nodesArray = [];
    this.edgesArray = [];
    this.idToNode = new Map();
    this.idToEdge = new Map();
  }

  /**
   * Ensure nodes `src` and `dst` are connected.
   * Return their `Edge` if so, otherwise
   * connect them and return their new `Edge`.
   * @param {EdgeOpts} opts
   */
  connect(opts) {
    const src = this.getNode(opts.src);
    const dst = this.getNode(opts.dst);

    if (src && dst) {
      const edge = this.getEdge(src, dst);
      if (edge) {
        return { edge, isNew: false };
      } else {
        // otherwise, instantiate one
        this.registerEdge(opts);
        return { edge, isNew: true };
      }
    }
    // can't connect a non-existent node
    console.error("Can't connect nodes:", { src, dst, context: { ...opts, graph: this } });
    //
    return { isNew: false, edge: null };
  }

  /**
   * Returns true iff was previously connected.
   * @param {NodeType} src;
   * @param {NodeType} dst
   */
  disconnect(src, dst) {
    const edge = this.getEdge(src, dst);
    if (edge) {
      this.removeEdge(edge);
      return true;
    } else {
      console.error("Failed to disconnect", src, dst, "in", this);
    }
    return false;
  }

  /** @param {string} edgeid */
  disconnectById(edgeid) {
    const edge = this.idToEdge.get(edgeid);
    if (edge) {
      return this.disconnect(edge.src, edge.dst);
    } else {
      console.error(`Cannot remove non-existent edge '${edgeid}'.`);
    }
    return false;
  }

  /**
   * @param {string} srcid
   * @param {string} dstid
   */
  disconnectByIds(srcid, dstid) {
    const src = this.idToNode.get(srcid);
    const dst = this.idToNode.get(dstid);
    if (src && dst) {
      // console.log(`Disconnecting`, src, dst);
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

  /**
   * Get co-reachable nodes in breadth-first manner.
   * @param {NodeType} node
   * @returns {NodeType[]}
   */
  getCoReachableNodes(node) {
    const coReachable = new Set([node]);
    let [count, frontier] = [0, [node]];
    while (coReachable.size > count) {
      count = coReachable.size;
      frontier = flatten(frontier.map((node) => this.getPreds(node)));
      frontier.forEach((node) => coReachable.add(node));
    }
    return Array.from(coReachable.values());
  }

  /**
   * Get `edge` from `src` to `dst`, or null.
   * @param {NodeType} src
   * @param {NodeType} dst
   */
  getEdge(src, dst) {
    const nhood = this.succ.get(src);
    return nhood ? nhood.get(dst) || null : null;
  }

  /**
   * Get all edges starting from `node`.
   * @param {NodeType} node
   */
  getEdgesFrom(node) {
    const succ = this.succ.get(node);
    return (succ && Array.from(succ.values())) || [];
  }

  /**
   * Get all edges ending at `node`.
   * @param {NodeType} node
   */
  getEdgesTo(node) {
    const pred = this.pred.get(node);
    return (pred && Array.from(pred.values())) || [];
  }

  /**
   * Get `edge` where `edge.id === id`, or null.
   * @param {string} id
   */
  getEdgeById(id) {
    return this.idToEdge.get(id) || null;
  }

  /**
   * https://dreampuf.github.io/GraphvizOnline/?engine=dot
   * https://dreampuf.github.io/GraphvizOnline/?engine=fdp
   * @param {string} graphName
   * @param {(edge: Graph.Edge<NodeType, EdgeOpts>) => string | null} [edgeLabel]
   */
  getGraphviz(graphName = "graph1", edgeLabel = () => null) {
    return `
digraph ${graphName} {
  
${this.nodesArray.map((x) => `  "${x.id}"\n`).join("")}

${this.edgesArray.map((x) => `  "${x.src.id}" -> "${x.dst.id}" ${edgeLabel(x) || ""}\n`).join("")}

}`;
  }

  /**
   * Get `node` where `node.id === id`, or null.
   * @param {NodeType['id']} id
   */
  getNode(id) {
    return this.idToNode.get(id) || null;
  }

  /**
   * We say a `node` _has a parent_ iff it has a single predecessor.
   * @param {NodeType} node
   */
  getParent(node) {
    const preds = this.getPreds(node);
    return preds.length === 1 ? preds[0] : null;
  }

  /**
   * Get all predecessor nodes of `node`.
   * @param {NodeType} node
   */
  getPreds(node) {
    // log(`Getting preds of:`, node);
    const pred = this.pred.get(node);
    return (pred && Array.from(pred.keys())) || [];
  }

  /**
   * Get reachable nodes in breadth-first manner.
   * @param {NodeType | string} node
   * @returns {NodeType[]}
   */
  getReachableNodes(node) {
    node = typeof node === "string" ? /** @type {NodeType} */ (this.getNode(node)) : node;
    const reachable = new Set([node]);
    let [count, frontier] = [0, [node]];
    while (reachable.size > count) {
      count = reachable.size;
      frontier = flatten(frontier.map((node) => this.getSuccs(node)));
      frontier.forEach((node) => reachable.add(node));
    }
    return Array.from(reachable.values());
  }

  /**
   * For example `stopWhen(_, depth) { return depth === 3; }`
   *
   * @param {NodeType | string} node node or node id
   * @param {(node: NodeType, depth: number) => boolean} stopWhen
   * @returns {NodeType[]}
   */
  getReachableUpTo(
    node,
    /**
     * Predicate should evaluate true at `node` iff we
     * should __not__ aggregate its successors.
     */
    stopWhen,
  ) {
    const root = typeof node === "string" ? /** @type {NodeType} */ (this.getNode(node)) : node;
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

  /**
   * Get all successor nodes of `node`.
   * @param {NodeType} node
   */
  getSuccs(node) {
    const succ = this.succ.get(node);
    return (succ && Array.from(succ.keys())) || [];
  }

  /**
   * Is the given node in the graph?
   * @param {NodeType} node
   */
  hasNode(node) {
    return this.nodes.has(node);
  }

  /**
   * Is there an edge from `src` to `dst`?
   * @param {NodeType} src
   * @param {NodeType} dst
   */
  isConnected(src, dst) {
    const succ = this.succ.get(src);
    return (succ && succ.has(dst)) || false;
  }

  /**
   * Return true iff `node` has some predecessor.
   * @param {NodeType} node
   */
  nodeHasPred(node) {
    const pred = this.pred.get(node);
    return (pred && pred.size > 0) || false;
  }

  /**
   * Return true iff `node` has some successor.
   * @param {NodeType} node
   */
  nodeHasSucc(node) {
    const succ = this.succ.get(node);
    return (succ && succ.size > 0) || false;
  }

  /**
   * - We assume graph is currently empty.
   * - We assume serializable node has same type as graph node.
   * - If not, we should add a custom method e.g. `from`.
   * @param {Graph.GraphJson<NodeType, EdgeOpts>} json
   * @returns {this}
   */
  plainFrom(json) {
    const nodes = json.nodes.map(deepClone);
    this.registerNodes(nodes);
    json.edges.forEach((def) => this.registerEdge(def));
    return this;
  }

  /**
   * We assume serializable node has same type as graph node.
   * If not, we'll add a custom method e.g. `json`.
   * @returns {Graph.GraphJson<NodeType, EdgeOpts>}
   */
  plainJson() {
    return {
      nodes: this.nodesArray.map(deepClone),
      edges: this.edgesArray.map(
        (edge) => /** @type {*} */ (deepClone({ ...edge, id: edge.id, src: edge.src.id, dst: edge.dst.id })),
      ),
    };
  }

  /**
   * Register a (presumed new) node with the graph.
   * @param {NodeType} node
   * @protected
   */
  registerNode(node) {
    this.nodes.add(node);
    this.nodesArray.push(node);
    this.succ.set(node, new Map());
    this.pred.set(node, new Map());
    this.idToNode.set(node.id, node);
  }

  /**
   * Register (presumed new) nodes with the graph.
   * @param {NodeType[]} nodes
   * @protected
   */
  registerNodes(nodes) {
    nodes.forEach((node) => {
      this.nodes.add(node);
      this.succ.set(node, new Map());
      this.pred.set(node, new Map());
      this.idToNode.set(node.id, node);
    });
    this.nodesArray.push(...nodes);
  }

  /**
   * Register a new edge.
   * We assume respective nodes already registered.
   * @param {EdgeOpts} def
   * @protected
   */
  registerEdge(def) {
    const [src, dst] = [this.getNode(def.src), this.getNode(def.dst)];
    if (src && dst) {
      /** @type {Graph.Edge<NodeType, EdgeOpts>} */
      const edge = { ...def, src, dst, id: `${def.src}->${def.dst}` };
      const succ = /** @type {Map<NodeType, Graph.Edge<NodeType, EdgeOpts>>} */ (this.succ.get(src));
      const pred = /** @type {Map<NodeType, Graph.Edge<NodeType, EdgeOpts>>} */ (this.pred.get(dst));
      succ.set(dst, edge);
      pred.set(src, edge);
      this.idToEdge.set(edge.id, edge);
      this.edgesArray.push(edge);
    } else {
      console.warn(chalk.red("error adding edge"), chalk.yellow(JSON.stringify(def)));
    }
  }

  /** @param {Graph.Edge<NodeType, EdgeOpts> | null} edge */
  removeEdge(edge) {
    if (edge) {
      const succ = this.succ.get(edge.src);
      if (succ) {
        succ.delete(edge.dst);
      }
      const pred = this.pred.get(edge.dst);
      if (pred) {
        pred.delete(edge.src);
      }
      this.idToEdge.delete(edge.id);
      removeFirst(this.edgesArray, edge);
    }
  }

  /** @param {NodeType} node */
  removeNode(node) {
    if (this.nodes.has(node)) {
      this.nodes.delete(node);
      removeFirst(this.nodesArray, node);
      this.idToNode.delete(node.id);
      // remove edges to `node`
      this.getPreds(node).forEach((other) => this.removeEdge(this.getEdge(other, node)));
      // remove edges from `node`
      this.getSuccs(node).forEach((other) => this.removeEdge(this.getEdge(node, other)));

      this.succ.delete(node);
      this.pred.delete(node);
      return true;
    }
    return false;
  }

  /** @param {string} id */
  removeNodeById(id) {
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

  /**
   * From leaves to co-leaves
   * @returns {NodeType[][]}
   */
  stratify() {
    let frontier = /** @type {NodeType[]} */ ([]);
    let unseen = this.nodesArray.slice();
    const seen = /** @type {Set<NodeType>} */ (new Set());
    const output = /** @type {NodeType[][]} */ ([]);

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

/**
 * @param {Partial<Graph.AStarNode['astar']>} partial
 * @return {Graph.AStarNode}
 */
export function createBaseAstar(partial) {
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
