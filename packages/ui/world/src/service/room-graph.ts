// 🔔 why do we need this?
/// <reference types="../world-graph.d.ts" />
import { BaseGraph } from "@npc-cli/graph";
import { error } from "@npc-cli/util/legacy/generic";

export class RoomGraph extends BaseGraph<Graph.RoomGraphNode, Graph.RoomGraphEdgeOpts> {
  static from(gm: Geomorph.Layout, errorPrefix = "") {
    return new RoomGraph().plainFrom(RoomGraph.json(gm, errorPrefix));
  }

  getAdjacentDoors(...roomIds: number[]) {
    const doors = new Set<Graph.RoomGraphNodeDoor>();
    roomIds.forEach((roomId) =>
      this.getSuccs(this.nodesArray[roomId]).forEach((other) => other.type === "door" && doors.add(other)),
    );
    return Array.from(doors);
  }

  getAdjacentHullDoorIds(gm: Geomorph.LayoutInstance, ...roomIds: number[]) {
    return this.getAdjacentDoors(...roomIds)
      .map((node) => [node, gm.doors[node.doorId]] as const)
      .flatMap(([{ doorId }, door]) =>
        door.roomIds.some((x) => x === null) ? { doorId, hullDoorId: gm.hullDoors.indexOf(door) } : [],
      );
  }

  getAdjacentWindows(...roomIds: number[]) {
    const windows = new Set<Graph.RoomGraphNodeWindow>();
    roomIds.forEach((roomId) =>
      this.getSuccs(this.nodesArray[roomId]).forEach((other) => other.type === "window" && windows.add(other)),
    );
    return Array.from(windows);
  }

  getAdjacentRooms(...nodes: Graph.RoomGraphNodeConnector[]) {
    const rooms = new Set<Graph.RoomGraphNodeRoom>();
    nodes.forEach((node) => this.getSuccs(node).forEach((other) => other.type === "room" && rooms.add(other)));
    return Array.from(rooms);
  }

  getDoorNode(doorId: number) {
    return this.getNode(`door-${doorId}`) as Graph.RoomGraphNodeDoor;
  }

  getAdjRoomIds(
    roomId: number,
    canAccess: (opts: { type: "door"; doorId: number } | { type: "window"; windowId: number }) => boolean = () => true,
  ) {
    return this.getSuccs(this.nodesArray[roomId]).flatMap((adjNode) => {
      if (
        (adjNode.type === "door" && canAccess({ type: "door", doorId: adjNode.doorId }) === true) ||
        (adjNode.type === "window" && canAccess({ type: "window", windowId: adjNode.windowId }) === true)
      ) {
        return this.getOtherRoom(adjNode, roomId)?.roomId ?? [];
      }
      return [];
    });
  }

  getOtherRoom(doorOrWindowNode: Graph.RoomGraphNodeConnector, roomId: number) {
    return (this.getSuccs(doorOrWindowNode).find((x) => x.type === "room" && x.roomId !== roomId) ??
      null) as Graph.RoomGraphNodeRoom | null;
  }

  getRoomNode(roomId: number) {
    return this.nodesArray[roomId];
  }

  getWindowNode(windowIndex: number) {
    return this.getNode(`window-${windowIndex}`) as Graph.RoomGraphNodeWindow;
  }

  static json(gm: Geomorph.Layout, errorPrefix = ""): Graph.RoomGraphJson {
    const { rooms, doors, windows } = gm;

    const doorsRoomIds = doors.map(({ roomIds }) =>
      roomIds.filter((x): x is number => typeof x === "number").sort((a, b) => a - b),
    );
    const windowsRoomIds = windows.map(({ roomIds }) =>
      roomIds.filter((x): x is number => typeof x === "number").sort((a, b) => a - b),
    );

    const roomGraphNodes: Graph.RoomGraphNode[] = [
      ...rooms.map(
        (_, roomId): Graph.RoomGraphNodeRoom => ({
          id: `room-${roomId}`,
          type: "room",
          roomId,
        }),
      ),
      ...doors.map(
        (_, doorId): Graph.RoomGraphNodeDoor => ({
          id: `door-${doorId}`,
          type: "door",
          doorId,
        }),
      ),
      ...windows.map(
        (_, windowId): Graph.RoomGraphNodeWindow => ({
          id: `window-${windowId}`,
          type: "window",
          windowId,
        }),
      ),
    ];

    const roomGraphEdges: Graph.RoomGraphEdgeOpts[] = [
      ...doors.flatMap((_door, doorId) => {
        const roomIds = doorsRoomIds[doorId];
        if ([1, 2].includes(roomIds.length)) {
          return roomIds.flatMap((roomId) => [
            { src: `room-${roomId}`, dst: `door-${doorId}` },
            { dst: `room-${roomId}`, src: `door-${doorId}` },
          ]);
        }
        error(`${errorPrefix}door ${doorId}: unexpected adjacent rooms: ${JSON.stringify(roomIds)}`);
        return [];
      }),
      ...windows.flatMap((_window, windowIndex) => {
        const roomIds = windowsRoomIds[windowIndex];
        if ([1, 2].includes(roomIds.length)) {
          return roomIds.flatMap((roomId) => [
            { src: `room-${roomId}`, dst: `window-${windowIndex}` },
            { dst: `room-${roomId}`, src: `window-${windowIndex}` },
          ]);
        }
        error(`${errorPrefix}window ${windowIndex}: unexpected adjacent rooms: ${JSON.stringify(roomIds)}`);
        return [];
      }),
    ];

    return { nodes: roomGraphNodes, edges: roomGraphEdges };
  }
}
