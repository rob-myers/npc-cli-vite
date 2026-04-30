/** biome-ignore-all lint/complexity/noStaticOnlyClass: faithful to source */
import { BinaryHeap } from "./BinaryHeap";
import { Utils } from "./Utils";

export class AStar {
  static init(graph: Graph.BaseGraph<Graph.AStarNode>, initNodeCosts: (nodes: Graph.AStarNode[]) => void) {
    const nodes = graph.nodesArray;
    for (let x = 0; x < nodes.length; x++) {
      const node = nodes[x].astar;
      node.f = 0;
      node.g = 0;
      node.h = 0;
      node.visited = false;
      node.closed = false;
      node.parent = null;
    }
    initNodeCosts(nodes);
  }

  static cleanUp(graph: Graph.AStarNode[]) {
    for (let x = 0; x < graph.length; x++) {
      const node = graph[x].astar as Partial<Graph.AStarNode["astar"]>;
      delete node.f;
      delete node.g;
      delete node.h;
      delete node.cost;
      delete node.visited;
      delete node.closed;
      delete node.parent;
    }
  }

  static heap<T extends Graph.AStarNode>() {
    return new BinaryHeap<T>((node) => node.astar.f as number);
  }

  static search<T extends Graph.AStarNode>({
    graph,
    start,
    end,
    setNodeWeights,
  }: {
    graph: Graph.BaseGraph<T>;
    start: T;
    end: T;
    setNodeWeights(nodes: Graph.AStarNode[]): void;
  }): AStarSearchResult<T> {
    AStar.init(graph, setNodeWeights);
    const nodes = graph.nodesArray;
    const minNode = { hScore: Infinity, node: start };

    const openHeap = AStar.heap<T>();
    openHeap.push(start);

    while (openHeap.size() > 0) {
      const currentNode = openHeap.pop();

      if (currentNode === end) {
        return { success: true, pathOrPrefix: AStar.unwindResult<T>(start, currentNode) };
      }

      currentNode.astar.closed = true;

      const neighbours = AStar.neighbours<T>(nodes, currentNode);

      for (let i = 0, il = neighbours.length; i < il; i++) {
        const neighbour = neighbours[i];

        if (neighbour.astar.closed === true) {
          continue;
        }

        const gScore = (currentNode.astar.g as number) + neighbour.astar.cost;
        const beenVisited = neighbour.astar.visited;

        if (!beenVisited || gScore < (neighbour.astar.g as number)) {
          neighbour.astar.visited = true;
          neighbour.astar.parent = currentNode;
          // if (!neighbour.astar.centroid || !end.astar.centroid) {
          //   throw new Error("Unexpected state");
          // }
          neighbour.astar.g = gScore;
          neighbour.astar.h ||= AStar.heuristic(neighbour.astar.centroid, end.astar.centroid);
          neighbour.astar.f = neighbour.astar.g + neighbour.astar.h;
          if (neighbour.astar.h < minNode.hScore) {
            minNode.hScore = neighbour.astar.h;
            minNode.node = neighbour;
          }

          if (!beenVisited) {
            openHeap.push(neighbour);
          } else {
            openHeap.rescoreElement(neighbour);
          }
        }
      }
    }

    // 🔔 expect unnatural prefixes
    return {
      success: false,
      pathOrPrefix: minNode.node === start ? [start] : AStar.unwindResult<T>(start, minNode.node),
    };
  }

  static heuristic(pos1: Geom.VectJson, pos2: Geom.VectJson) {
    return Utils.distanceToSquared(pos1, pos2);
  }

  static neighbours<T extends Graph.AStarNode>(graph: T[], node: T) {
    const ret = [] as T[];
    for (let e = 0; e < node.astar.neighbours.length; e++) {
      ret.push(graph[node.astar.neighbours[e]]);
    }
    return ret;
  }

  static unwindResult<T extends Graph.AStarNode>(start: T, curr: T) {
    const output = [] as T[];
    while (curr.astar.parent !== null) {
      output.push(curr as T);
      curr = curr.astar.parent as T;
    }
    output.push(start);
    AStar.cleanUp(output);
    output.reverse();
    return output;
  }
}

export type AStarSearchResult<T extends Graph.AStarNode> = {
  success: boolean;
  /**
   * - On success this is the witnessing path including `start`, else a maximal prefix.
   * - e.g. if all doors of `start` are inaccessible then:
   *   > `success === false`, `pathOrPrefix === [start]`
   * - In particular, this array is never empty.
   */
  pathOrPrefix: T[];
};
