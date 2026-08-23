/** biome-ignore-all lint/complexity/noStaticOnlyClass: faithful to source */
import { BinaryHeap } from "./BinaryHeap";
import { Utils } from "./Utils";

export class AStar {
  static init<T extends Graph.AStarNode>(graph: Graph.BaseGraph<T>, setNodeWeights?: (nodes: T[]) => void) {
    const nodes = graph.nodesArray;
    for (const { astar: node } of nodes) {
      node.f = 0;
      node.g = 0;
      node.h = 0;
      node.cost = 1;
      node.visited = false;
      node.closed = false;
      node.parent = null;
    }
    setNodeWeights?.(nodes);
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
  }: AStarSearchOpts<T>): AStarSearchResult<T> {
    AStar.init(graph, setNodeWeights);

    const nodes = graph.nodesArray;
    const minNode = { hScore: Infinity, node: start };
    const openHeap = AStar.heap<T>();
    openHeap.push(start);

    while (openHeap.size() > 0) {
      const currentNode = openHeap.pop();

      if (currentNode === end) {
        return { success: true, path: AStar.unwindResult<T>(start, currentNode) };
      }

      currentNode.astar.closed = true;

      const neighbours = AStar.neighbours<T>(nodes, currentNode);

      for (const neighbour of neighbours) {
        if (neighbour.astar.closed === true) {
          continue;
        }

        const gScore = (currentNode.astar.g as number) + neighbour.astar.cost;
        const beenVisited = neighbour.astar.visited;

        if (!beenVisited || gScore < (neighbour.astar.g as number)) {
          neighbour.astar.visited = true;
          neighbour.astar.parent = currentNode;
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

    return { success: false, path: [] };
  }

  /**
   * `search`, spread over as many turns of the event loop as it takes — the same algorithm, with a
   * yield whenever it has held the thread for `sliceMs`. A search over a large graph otherwise
   * blocks the frame it lands in, and two of them run back to back whenever an npc is asked to
   * move (see `checkNpcTargetUnreachable`).
   *
   * SERIALISED per graph, because the algorithm keeps its working state on the nodes themselves
   * (`node.astar`, reset by `init`): two searches interleaved on one graph would each wipe the
   * other's. Yielding is exactly what makes that possible, so the queue is not optional.
   */
  static searchAsync<T extends Graph.AStarNode>({
    sliceMs = defaultSliceMs,
    ...opts
  }: AStarSearchOpts<T> & { sliceMs?: number }): Promise<AStarSearchResult<T>> {
    const queued = (searchQueue.get(opts.graph) ?? Promise.resolve()).then(() =>
      AStar.runSearchAsync({ ...opts, sliceMs }),
    );
    // the queue holds the TAIL, and must not reject with it: a failed search would otherwise take
    // every search behind it down
    searchQueue.set(
      opts.graph,
      queued.then(
        () => undefined,
        () => undefined,
      ),
    );
    return queued;
  }

  private static async runSearchAsync<T extends Graph.AStarNode>({
    graph,
    start,
    end,
    setNodeWeights,
    sliceMs,
  }: AStarSearchOpts<T> & { sliceMs: number }): Promise<AStarSearchResult<T>> {
    AStar.init(graph, setNodeWeights);

    const nodes = graph.nodesArray;
    const minNode = { hScore: Infinity, node: start };
    const openHeap = AStar.heap<T>();
    openHeap.push(start);

    let sliceStart = performance.now();

    while (openHeap.size() > 0) {
      // between whole expansions, never within one: the node state is consistent here and nowhere
      // else, so this is the only point at which another search may take a turn
      if (performance.now() - sliceStart > sliceMs) {
        await yieldToEventLoop();
        sliceStart = performance.now();
      }

      const currentNode = openHeap.pop();

      if (currentNode === end) {
        return { success: true, path: AStar.unwindResult<T>(start, currentNode) };
      }

      currentNode.astar.closed = true;

      for (const neighbour of AStar.neighbours<T>(nodes, currentNode)) {
        if (neighbour.astar.closed === true) {
          continue;
        }

        const gScore = (currentNode.astar.g as number) + neighbour.astar.cost;
        const beenVisited = neighbour.astar.visited;

        if (!beenVisited || gScore < (neighbour.astar.g as number)) {
          neighbour.astar.visited = true;
          neighbour.astar.parent = currentNode;
          neighbour.astar.g = gScore;
          neighbour.astar.h ||= AStar.heuristic(neighbour.astar.centroid, end.astar.centroid);
          neighbour.astar.f = neighbour.astar.g + neighbour.astar.h;
          if (neighbour.astar.h < minNode.hScore) {
            minNode.hScore = neighbour.astar.h;
            minNode.node = neighbour;
          }

          beenVisited ? openHeap.rescoreElement(neighbour) : openHeap.push(neighbour);
        }
      }
    }

    return { success: false, path: [] };
  }

  static heuristic(pos1: Geom.VectJson, pos2: Geom.VectJson) {
    return Utils.distanceToSquared(pos1, pos2);
  }

  static neighbours<T extends Graph.AStarNode>(graphNodes: T[], node: T) {
    const ret = [] as T[];
    for (let i = 0; i < node.astar.neighbours.length; i++) {
      ret.push(graphNodes[node.astar.neighbours[i]]);
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

export type AStarSearchOpts<T extends Graph.AStarNode> = {
  graph: Graph.BaseGraph<T>;
  start: T;
  end: T;
  setNodeWeights?(nodes: T[]): void;
};

export type AStarSearchResult<T extends Graph.AStarNode> = {
  success: boolean;
  path: T[];
};

/** How long a slice of `searchAsync` may hold the thread */
const defaultSliceMs = 1;

/** The tail of the searches queued per graph — see `searchAsync` */
const searchQueue = new WeakMap<Graph.BaseGraph<Graph.AStarNode>, Promise<unknown>>();

/**
 * Back of the queue, letting the browser do whatever it must first. A message rather than a
 * `setTimeout`, whose 4ms clamp would make a long search take far longer than the work in it
 */
function yieldToEventLoop() {
  return new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}
