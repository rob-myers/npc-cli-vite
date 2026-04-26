// 🔔 jsdoc types hack (tsgo)
/// <reference types="../world-graph.d.ts" />

import { BaseGraph } from "@npc-cli/graph";
import { error } from "@npc-cli/util/legacy/generic";

/**
 * - The nodes are the rooms and doors of a fixed geomorph.
 * - Nodes are adjacent iff one is a door, the other is a room, and
 *   the door is adjacent to the room.
 * - Then this is a symmetric directed graph, without edge labels.
 * @extends {BaseGraph<Graph.RoomGraphNode, Graph.RoomGraphEdgeOpts>}
 */
export class RoomGraph extends BaseGraph {
  /** @param {Geomorph.Layout} gm  */
  static from(gm, errorPrefix = "") {
    return new RoomGraph().plainFrom(RoomGraph.json(gm, errorPrefix));
  }

  /**
   * Given roomIds (particular nodes), find all adjacent doors.
   * @param {...number} roomIds
   */
  getAdjacentDoors(...roomIds) {
    const doors = /** @type {Set<Graph.RoomGraphNodeDoor>} */ (new Set());
    roomIds.forEach((roomId) =>
      this.getSuccs(this.nodesArray[roomId]).forEach((other) => other.type === "door" && doors.add(other)),
    );
    return Array.from(doors);
  }
  /**
   * Given parent `gm` and some nodes, find adjacent _hull door ids_ (if any).
   * @param {Geomorph.LayoutInstance} gm
   * @param {...number} roomIds
   */
  getAdjacentHullDoorIds(gm, ...roomIds) {
    return this.getAdjacentDoors(...roomIds)
      .map((node) => /** @type {const} */ ([node, gm.doors[node.doorId]]))
      .flatMap(([{ doorId }, door]) =>
        door.roomIds.some((x) => x === null) ? { doorId, hullDoorId: gm.hullDoors.indexOf(door) } : [],
      );
  }

  /**
   * Given nodes, find all adjacent windows.
   * @param {...number} roomIds
   */
  getAdjacentWindows(...roomIds) {
    const windows = /** @type {Set<Graph.RoomGraphNodeWindow>} */ (new Set());
    roomIds.forEach((roomId) =>
      this.getSuccs(this.nodesArray[roomId]).forEach((other) => other.type === "window" && windows.add(other)),
    );
    return Array.from(windows);
  }

  /**
   * Given door/window nodes find all adjacent rooms.
   * @param {...Graph.RoomGraphNodeConnector} nodes
   */
  getAdjacentRooms(...nodes) {
    const rooms = /** @type {Set<Graph.RoomGraphNodeRoom>} */ (new Set());
    nodes.forEach((node) => this.getSuccs(node).forEach((other) => other.type === "room" && rooms.add(other)));
    return Array.from(rooms);
  }

  /** @param {number} doorId */
  getDoorNode(doorId) {
    return /** @type {Graph.RoomGraphNodeDoor} */ (this.getNode(`door-${doorId}`));
  }

  /**
   * Given room id, find all rooms reachable via a single window or (open) door.
   * - Does not include `roomId`.
   * - Can specify accessible doors/windows.
   * @param {number} roomId
   * @param {(opts: (
   *   | { type: 'door'; doorId: number }
   *   | { type: 'window'; windowId: number }
   * )) => boolean} [canAccess]
   */
  getAdjRoomIds(roomId, canAccess = () => true) {
    return this.getSuccs(this.nodesArray[roomId]).flatMap((adjNode) => {
      if (
        (adjNode.type === "door" && canAccess({ type: "door", doorId: adjNode.doorId }) === true) ||
        (adjNode.type === "window" && canAccess({ type: "window", windowId: adjNode.windowId }) === true)
      ) {
        return this.getOtherRoom(adjNode, roomId)?.roomId ?? [];
      } else {
        return [];
      }
    });
  }

  /**
   *
   * @param {Graph.RoomGraphNodeConnector} doorOrWindowNode
   * @param {number} roomId
   */
  getOtherRoom(doorOrWindowNode, roomId) {
    return /** @type {null | Graph.RoomGraphNodeRoom} x */ (
      this.getSuccs(doorOrWindowNode).find((x) => x.type === "room" && x.roomId !== roomId) ?? null
    );
  }

  /** @param {number} roomId */
  getRoomNode(roomId) {
    return this.nodesArray[roomId];
  }

  /** @param {number} windowIndex */
  getWindowNode(windowIndex) {
    return /** @type {Graph.RoomGraphNodeWindow} */ (this.getNode(`window-${windowIndex}`));
  }

  /**
   * @param {Geomorph.Layout} gm
   * @param {string} [errorPrefix]
   * @returns {Graph.RoomGraphJson}
   */
  static json(gm, errorPrefix = "") {
    const { rooms, doors, windows } = gm;
    /**
     * For each door, respective ascending adjacent room ids.
     * Each array will be aligned with the respective door node's successors.
     */
    const doorsRoomIds = doors.map(({ roomIds }) =>
      roomIds.filter(/** @return {x is number} */ (x) => typeof x === "number").sort((a, b) => a - b),
    );
    const windowsRoomIds = windows.map(({ roomIds }) =>
      roomIds.filter(/** @return {x is number} */ (x) => typeof x === "number").sort((a, b) => a - b),
    );

    /** @type {Graph.RoomGraphNode[]} */
    const roomGraphNodes = [
      // Observe that `roomId` is the respective node id,
      // because we start the nodes with the room nodes
      ...rooms.map((_, roomId) => ({
        id: `room-${roomId}`,
        type: /** @type {const} */ ("room"),
        roomId,
      })),
      ...doors.map(
        /** @returns {Graph.RoomGraphNodeDoor} */ (_, doorId) => ({
          id: `door-${doorId}`,
          type: /** @type {const} */ ("door"),
          doorId,
        }),
      ),
      ...windows.map(
        /** @returns {Graph.RoomGraphNodeWindow} */ (_, windowId) => ({
          id: `window-${windowId}`,
          type: /** @type {const} */ ("window"),
          windowId,
        }),
      ),
    ];

    /** @type {Graph.RoomGraphEdgeOpts[]} */
    const roomGraphEdges = [
      ...doors.flatMap((_door, doorId) => {
        const roomIds = doorsRoomIds[doorId];
        if ([1, 2].includes(roomIds.length)) {
          // Hull door has 1, standard has 2
          return roomIds.flatMap((roomId) => [
            // undirected, so 2 directed edges
            { src: `room-${roomId}`, dst: `door-${doorId}` },
            { dst: `room-${roomId}`, src: `door-${doorId}` },
          ]);
        } else {
          error(`${errorPrefix}door ${doorId}: unexpected adjacent rooms: ${JSON.stringify(roomIds)}`);
          return [];
        }
      }),
      ...windows.flatMap((_window, windowIndex) => {
        const roomIds = windowsRoomIds[windowIndex];
        if ([1, 2].includes(roomIds.length)) {
          // Hull window has 1, standard has 2
          return roomIds.flatMap((roomId) => [
            // undirected, so 2 directed edges
            { src: `room-${roomId}`, dst: `window-${windowIndex}` },
            { dst: `room-${roomId}`, src: `window-${windowIndex}` },
          ]);
        } else {
          error(`${errorPrefix}window ${windowIndex}: unexpected adjacent rooms: ${JSON.stringify(roomIds)}`);
          return [];
        }
      }),
    ];

    /** @type {Graph.RoomGraphJson} */
    const roomGraphJson = {
      nodes: roomGraphNodes,
      edges: roomGraphEdges,
    };

    return roomGraphJson;
  }
}
