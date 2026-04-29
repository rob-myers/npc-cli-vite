import { BaseGraph, createBaseAstar } from "@npc-cli/graph";
import { AStar } from "../pathfinding/AStar";
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

    return graph;
  }

  findPath(
    src: Geomorph.GmRoomKey,
    dst: Geomorph.GmRoomKey,
    setWeights?: (nodes: Graph.GmRoomGraphNode[]) => void,
  ): Graph.GmRoomGraphNode[] | null {
    const srcNode = this.getNode(src);
    const dstNode = this.getNode(dst);
    if (srcNode === null || dstNode === null) {
      return null;
    }
    const path = AStar.search(this, srcNode, dstNode, (nodes) => {
      setWeights?.(nodes as Graph.GmRoomGraphNode[]);
    });
    return path.length === 0 ? null : path;
  }

  sameOrAdjRooms(grKey1: Geomorph.GmRoomKey, grKey2: Geomorph.GmRoomKey) {
    if (grKey1 === grKey2) {
      return true;
    }
    const src = this.getNode(grKey1);
    const dst = this.getNode(grKey2);
    if (src === null || dst === null) {
      return false;
    }
    const srcSuccs = this.getSuccs(src);
    const dstSuccs = new Set(this.getSuccs(dst));
    return srcSuccs.some((node) => dstSuccs.has(node));
  }
}
