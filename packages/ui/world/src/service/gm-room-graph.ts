import { BaseGraph, createBaseAstar } from "@npc-cli/graph";
import type DerivedGmsData from "./DerivedGmsData";
import { helper } from "./helper";

export class GmRoomGraph extends BaseGraph<Graph.GmRoomGraphNode, Graph.GmRoomGraphEdgeOpts> {
  static fromGmGraph(gmGraph: Graph.GmGraph, gmsData: DerivedGmsData): Graph.GmRoomGraph {
    const graph = new GmRoomGraph();
    let index = 0;

    const nodes: Graph.GmRoomGraphNode[] = gmGraph.gms.flatMap((gm, gmId) =>
      gm.rooms.map((room, roomId) => ({
        id: helper.getGmRoomKey(gmId, roomId),
        gmId,
        roomId,
        ...createBaseAstar({
          centroid: gm.matrix.transformPoint(room.center),
        }),
        index: index++,
      })),
    );

    graph.registerNodes(nodes);

    gmGraph.gms.forEach((gm, gmId) => {
      gm.rooms.forEach((_, roomId) => {
        const { roomGraph } = gmsData.byKey[gm.key];

        const succ = roomGraph.getAdjacentDoors(roomId).reduce(
          (agg, { doorId }) => {
            if (gm.isHullDoor(doorId)) {
              const ctxt = gmGraph.getAdjacentRoomCtxt(gmId, doorId);
              if (ctxt !== null) {
                (agg[ctxt.adjGmRoomKey] ??= [[], []])[0].push(helper.getGmDoorId(gmId, doorId));
              }
            } else {
              const otherRoomId = gm.getOtherRoomId(doorId, roomId) as number;
              (agg[helper.getGmRoomKey(gmId, otherRoomId)] ??= [[], []])[0].push(helper.getGmDoorId(gmId, doorId));
            }
            return agg;
          },
          {} as { [gmRoomId: string]: [Geomorph.GmDoorId[], Graph.GmWindowId[]] },
        );

        roomGraph.getAdjacentWindows(roomId).forEach(({ windowId }) => {
          const otherRoomId = gm.windows[windowId].roomIds.find((x) => x !== roomId);
          typeof otherRoomId === "number" &&
            (succ[helper.getGmRoomKey(gmId, otherRoomId)] ??= [[], []])[1].push({ gmId, windowId });
        });

        const srcKey = helper.getGmRoomKey(gmId, roomId);
        for (const [gmRoomStr, [gmDoorIds, gmWindowIds]] of Object.entries(succ)) {
          const [gmId, roomId] = gmRoomStr.slice(1).split("r").map(Number);
          graph.connect({
            src: srcKey,
            dst: helper.getGmRoomKey(gmId, roomId),
            doors: gmDoorIds,
            windows: gmWindowIds,
          });
        }
      });
    });

    graph.edgesArray.forEach(({ src, dst }) => src.astar.neighbours.push(dst.index));

    return graph;
  }

  sameOrAdjRooms(grKey1: Geomorph.GmRoomKey, grKey2: Geomorph.GmRoomKey) {
    if (grKey1 === grKey2) {
      return true;
    }
    const src = this.getNode(grKey1) as Graph.GmRoomGraphNode;
    const dst = this.getNode(grKey2) as Graph.GmRoomGraphNode;
    return this.succ.get(src)?.get(dst) !== undefined;
  }
}
