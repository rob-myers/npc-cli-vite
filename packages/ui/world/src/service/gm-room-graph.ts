import { BaseGraph, createBaseAstar } from "@npc-cli/graph";
import { jsStringify, warn } from "@npc-cli/util/legacy/generic";
import { AStar, type AStarSearchResult } from "../pathfinding/AStar";
import { helper } from "./helper";

export class GmRoomGraph extends BaseGraph<Graph.GmRoomGraphNode, Graph.GmRoomGraphEdgeOpts> {
  static fromGmGraph(gmGraph: Graph.GmGraph): Graph.GmRoomGraph {
    const graph = new GmRoomGraph();
    let index = 0;

    const roomNodes: Graph.GmRoomGraphNodeRoom[] = gmGraph.gms.flatMap((gm, gmId) =>
      gm.rooms.map((room, roomId) => ({
        type: "room" as const,
        id: helper.getGmRoomKey(gmId, roomId),
        gmId,
        roomId,
        grKey: helper.getGmRoomKey(gmId, roomId),
        ...createBaseAstar({ centroid: gm.matrix.transformPoint(room.center) }),
        index: index++,
      })),
    );

    const doorNodes: Graph.GmRoomGraphNodeDoor[] = gmGraph.gms.flatMap((gm, gmId) =>
      gm.doors.map((door, doorId) => ({
        type: "door" as const,
        id: helper.getGmDoorKey(gmId, doorId),
        gmId,
        doorId,
        gdKey: helper.getGmDoorKey(gmId, doorId),
        ...createBaseAstar({ centroid: gm.matrix.transformPoint(door.center.clone()) }),
        index: index++,
      })),
    );

    const windowNodes: Graph.GmRoomGraphNodeWindow[] = gmGraph.gms.flatMap((gm, gmId) =>
      gm.windows.map((window, windowId) => ({
        type: "window" as const,
        id: helper.getGmWindowKey(gmId, windowId),
        gmId,
        windowId,
        ...createBaseAstar({ centroid: gm.matrix.transformPoint(window.center.clone()) }),
        index: index++,
      })),
    );

    graph.registerNodes([...roomNodes, ...doorNodes, ...windowNodes]);

    gmGraph.gms.forEach((gm, gmId) => {
      gm.doors.forEach((door, doorId) => {
        const doorKey = helper.getGmDoorKey(gmId, doorId);

        if (gm.isHullDoor(doorId)) {
          const roomId = door.roomIds.find((x) => x !== null);
          if (typeof roomId === "number") {
            const roomKey = helper.getGmRoomKey(gmId, roomId);
            graph.connect({ src: roomKey, dst: doorKey });
            graph.connect({ src: doorKey, dst: roomKey });
          }
          const ctxt = gmGraph.getAdjacentRoomCtxt(gmId, doorId);
          if (ctxt !== null) {
            const adjDoorKey = helper.getGmDoorKey(ctxt.adjGmId, ctxt.adjDoorId);
            graph.connect({ src: doorKey, dst: adjDoorKey });
          }
        } else {
          door.roomIds.forEach((roomId) => {
            if (typeof roomId === "number") {
              const roomKey = helper.getGmRoomKey(gmId, roomId);
              graph.connect({ src: roomKey, dst: doorKey });
              graph.connect({ src: doorKey, dst: roomKey });
            }
          });
        }
      });

      gm.windows.forEach((window, windowId) => {
        const windowKey = helper.getGmWindowKey(gmId, windowId);
        window.roomIds.forEach((roomId) => {
          if (typeof roomId === "number") {
            const roomKey = helper.getGmRoomKey(gmId, roomId);
            graph.connect({ src: roomKey, dst: windowKey });
            graph.connect({ src: windowKey, dst: roomKey });
          }
        });
      });
    });

    graph.edgesArray.forEach(({ src, dst }) => src.astar.neighbours.push(dst.index));

    gmGraph.gms.forEach((gm, gmId) => decorateLineOfSight(graph, gm, gmId));

    return graph;
  }

  /**
   * A path between two rooms, spread over as many turns of the event loop as it takes — see
   * `AStar.searchAsync`, which also serialises these so two cannot corrupt each other's working
   * state. There is deliberately no synchronous version: one could run inside another's yield and
   * wipe the node state it resumes into
   */
  findPathAsync(
    src: Geomorph.GmRoomKey,
    dst: Geomorph.GmRoomKey,
    opts?: {
      setNodeWeights?(nodes: Graph.GmRoomGraphNode[]): void;
    },
  ): Promise<AStarSearchResult<Graph.GmRoomGraphNode>> {
    const srcNode = this.getNode(src);
    const dstNode = this.getNode(dst);
    if (srcNode === null || dstNode === null) {
      throw Error(`srcNode and dstNode cannot be null: ${jsStringify({ srcNode, dstNode })}`);
    }
    return AStar.searchAsync({
      graph: this,
      start: srcNode,
      end: dstNode,
      setNodeWeights: opts?.setNodeWeights,
    });
  }

  getAdjRoomsDoors(grKey1: Geomorph.GmRoomKey, grKey2: Geomorph.GmRoomKey) {
    if (grKey1 === grKey2) {
      return [];
    }
    const src = this.getNode(grKey1);
    const dst = this.getNode(grKey2);
    if (src === null || dst === null) {
      return [];
    }

    const dstSucc = this.succ.get(dst) ?? emptySuccMap;
    return this.getSuccs(src).filter((node): node is Graph.GmRoomGraphNodeDoor => dstSucc.has(node) ?? false);
  }
}

/**
 * Resolve tag `rel=sees:{name}` against tag `name={name}`, over this geomorph's doors ⋃ windows,
 * i.e. either end can be a door or a window. `service/geomorph` numbers each name per symbol file
 * and per copy of that symbol, so a name means one thing only.
 *
 * Recorded as `node.lineOfSight` rather than edges: `astar.neighbours` is built from EVERY edge, so
 * an edge here would let a path walk through a window it can only see through
 */
function decorateLineOfSight(graph: GmRoomGraph, gm: Geomorph.LayoutInstance, gmId: number) {
  const connectors = [
    ...gm.doors.map((x, doorId) => ({ meta: x.meta, key: helper.getGmDoorKey(gmId, doorId) })),
    ...gm.windows.map((x, windowId) => ({ meta: x.meta, key: helper.getGmWindowKey(gmId, windowId) })),
  ];

  const byName = new Map<string, Geomorph.SeesKey[]>();
  for (const { meta, key } of connectors) {
    typeof meta.name === "string" && (byName.get(meta.name)?.push(key) ?? byName.set(meta.name, [key]));
  }

  const see = (from: Geomorph.SeesKey, to: Geomorph.SeesKey) => {
    const node = graph.getNode(from);
    if (node === null) return;
    const seen = (node.lineOfSight ??= []);
    seen.includes(to) === false && seen.push(to);
  };

  for (const { meta, key } of connectors) {
    // `meta.rel` is `{relation}:{name}` — only `sees` for now
    const name = typeof meta.rel === "string" && meta.rel.startsWith("sees:") ? meta.rel.slice(5) : null;
    if (name === null) continue;
    // exclude self i.e. `name=x sees=x`
    const dsts = (byName.get(name) ?? []).filter((dst) => dst !== key);
    if (dsts.length === 0) {
      warn(`${gm.key}: rel=sees:${name}: no connector has tag name=${name}`);
      continue;
    }
    // seeing is mutual, so only one end need say so
    for (const dst of dsts) {
      see(key, dst);
      see(dst, key);
    }
  }
}

const emptySuccMap = new Map<Graph.GmRoomGraphNode, Graph.Edge<Graph.GmRoomGraphNode, Graph.GmRoomGraphEdgeOpts>>();
