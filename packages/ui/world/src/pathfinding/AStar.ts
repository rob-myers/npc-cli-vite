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

  static heap() {
    return new BinaryHeap<Graph.AStarNode>((node) => node.astar.f!);
  }

  static search<T extends Graph.AStarNode>(
    graph: Graph.BaseGraph<Graph.AStarNode>,
    start: T,
    end: T,
    initNodeCosts: (nodes: Graph.AStarNode[]) => void,
  ): T[] {
    AStar.init(graph, initNodeCosts);
    const nodes = graph.nodesArray;

    const openHeap = AStar.heap();
    openHeap.push(start);

    while (openHeap.size() > 0) {
      const currentNode = openHeap.pop();

      if (currentNode === end) {
        let curr = currentNode;
        const result: T[] = [];
        while (curr.astar.parent) {
          result.push(curr as T);
          curr = curr.astar.parent;
        }
        result.push(start);
        AStar.cleanUp(result);
        result.reverse();
        return result;
      }

      currentNode.astar.closed = true;

      const neighbours = AStar.neighbours(nodes, currentNode);

      for (let i = 0, il = neighbours.length; i < il; i++) {
        const neighbour = neighbours[i];

        if (neighbour.astar.closed) {
          continue;
        }

        const gScore = currentNode.astar.g! + neighbour.astar.cost;
        const beenVisited = neighbour.astar.visited;

        if (!beenVisited || gScore < neighbour.astar.g!) {
          neighbour.astar.visited = true;
          neighbour.astar.parent = currentNode;
          if (!neighbour.astar.centroid || !end.astar.centroid) throw new Error("Unexpected state");
          neighbour.astar.h = neighbour.astar.h || AStar.heuristic(neighbour.astar.centroid, end.astar.centroid);
          neighbour.astar.g = gScore;
          neighbour.astar.f = neighbour.astar.g + neighbour.astar.h;

          if (!beenVisited) {
            openHeap.push(neighbour);
          } else {
            openHeap.rescoreElement(neighbour);
          }
        }
      }
    }

    return [];
  }

  static heuristic(pos1: Geom.VectJson, pos2: Geom.VectJson) {
    return Utils.distanceToSquared(pos1, pos2);
  }

  static neighbours(graph: Graph.AStarNode[], node: Graph.AStarNode) {
    const ret = [];
    for (let e = 0; e < node.astar.neighbours.length; e++) {
      ret.push(graph[node.astar.neighbours[e]]);
    }
    return ret;
  }
}
