declare namespace Graph {
  //#region GmGraph

  type GmGraph = import("./service/gm-graph").GmGraph;

  interface BaseGmGraphNode extends AStarNode {
    /** Index into nodesArray for easy computation of astar.neighbours */
    index: number;
  }

  /** A transformed geomorph */
  interface GmGraphNodeGm extends BaseGmGraphNode {
    type: "gm";
    /** Key of parent geomorph */
    gmKey: Key.Geomorph;
    gmId: number;
    /** `gm-${gmKey}-[${transform}]` */
    id: string;
    /** Transform of parent geomorph */
    transform: [number, number, number, number, number, number];

    /** Points to `gm.navRects[navRectId]` */
    navRectId: number;
    /** `gm.navRects[navRectId].rect` in world coords */
    rect: Geom.Rect;
  }

  /** A hull door of some transformed geomorph */
  interface GmGraphNodeDoor extends BaseGmGraphNode {
    type: "door";
    /** `door-${gmKey}-[${transform}]-${hullDoorIndex}` */
    id: string;
    /** Key of parent geomorph */
    gmKey: Key.Geomorph;
    /** Index of parent geomorph instance in its respective array */
    gmId: number;
    /** Transform of parent geomorph */
    transform: [number, number, number, number, number, number];
    /** Index of `Geomorph.GeomorphData['doors']` */
    doorId: number;
    /** Index of `Geomorph.GeomorphData['hullDoors']` */
    hullDoorId: number;
    /**
     * Is this door's parent geomorph in front of it?
     * That is, is the door's normal facing it's parent?
     */
    gmInFront: boolean;
    /** Direction it faces in world coords */
    direction: null | Geom.DirectionString;
    /**
     * Is this door node not connected to another door i.e.
     * not connected to another geomorph?
     */
    sealed: boolean;
  }

  type GmGraphNode = GmGraphNodeGm | GmGraphNodeDoor;

  type GmGraphEdgeOpts = BaseEdgeOpts;

  /** Given a hull door, the respective ids in adjacent geomorph */
  interface GmAdjRoomCtxt {
    adjGmId: number;
    adjRoomId: number;
    adjGmRoomKey: Geomorph.GmRoomKey;
    adjHullId: number;
    adjDoorId: number;
    adjGdKey: Geomorph.GmDoorKey;
  }

  interface BaseNavGmTransition {
    srcGmId: number;
    srcRoomId: number;
    srcDoorId: number;
    dstGmId: number;
    dstRoomId: number;
    dstDoorId: number;
  }

  interface NavGmTransition extends BaseNavGmTransition {
    srcHullDoorId: number;
    /**
     * Entrypoint of the hull door from geomorph `srcGmId`,
     * in world coordinates.
     */
    srcDoorEntry: Geom.Vect;

    dstHullDoorId: number;
    /**
     * Entrypoint of the hull door from geomorph `dstGmId`,
     * in world coordinates.
     */
    dstDoorEntry: Geom.Vect;
  }

  /** Indexed by `gmId` */
  type GmRoomsAdjData = {
    [gmId: number]: {
      gmId: number;
      roomIds: number[];
      windowIds: number[];
    };
  };

  //#endregion

  //#region RoomGraph

  type RoomGraph = import("./service/room-graph").RoomGraph;

  interface RoomGraphNodeRoom {
    type: "room";
    /** `room-${roomId} */
    id: string;
    /** Index of `Geomorph.Layout['rooms']` */
    roomId: number;
  }
  interface RoomGraphNodeDoor {
    type: "door";
    /** `door-${doorIndex} */
    id: string;
    /** Index of `Geomorph.Layout['doors']` */
    doorId: number;
  }

  interface RoomGraphNodeWindow {
    type: "window";
    /** `window-${doorIndex} */
    id: string;
    /** Index of `Geomorph.Layout['windows']` */
    windowId: number;
  }

  type RoomGraphNode = RoomGraphNodeRoom | RoomGraphNodeDoor | RoomGraphNodeWindow;

  type RoomGraphNodeConnector = RoomGraphNodeDoor | RoomGraphNodeWindow;

  type RoomGraphEdgeOpts = BaseEdgeOpts;

  type RoomGraphJson = GraphJson<RoomGraphNode, RoomGraphEdgeOpts>;

  //#endregion

  //#region GmRoomGraph

  type GmRoomGraph = import("./service/gm-room-graph").GmRoomGraph;

  interface BaseGmRoomGraphNode extends AStarNode {
    index: number;
    gmId: number;
  }

  interface GmRoomGraphNodeRoom extends BaseGmRoomGraphNode {
    type: "room";
    id: Geomorph.GmRoomKey;
    roomId: number;
  }

  interface GmRoomGraphNodeDoor extends BaseGmRoomGraphNode {
    type: "door";
    id: Geomorph.GmDoorKey;
    doorId: number;
  }

  interface GmRoomGraphNodeWindow extends BaseGmRoomGraphNode {
    type: "window";
    id: Geomorph.GmWindowKey;
    windowId: number;
  }

  type GmRoomGraphNode = GmRoomGraphNodeRoom | GmRoomGraphNodeDoor | GmRoomGraphNodeWindow;

  type GmRoomGraphEdgeOpts = BaseEdgeOpts;

  //#endregion
}
