declare namespace Geomorph {
  type AssetsType = import("@npc-cli/ui__world/assets.schema").AssetsType;
  type AssetsSymbolLookup = import("@npc-cli/ui__world/assets.schema").AssetsSymbolLookup;
  type FlatSymbol = import("@npc-cli/ui__world/assets.schema").AssetsFlatSymbol;
  type Layout = import("@npc-cli/ui__world/assets.schema").GeomorphLayout;
  type LayoutInstance = import("@npc-cli/ui__world/assets.schema").GeomorphLayoutInstance;
  type LayoutObstacle = import("@npc-cli/ui__world/assets.schema").GeomorphLayoutObstacle;
  type MapDef = import("@npc-cli/ui__world/assets.schema").AssetsMapDef;
  type SubSymbol = import("@npc-cli/ui__world/assets.schema").AssetsSubSymbol;
  type Symbol = import("@npc-cli/ui__world/assets.schema").AssetsSymbol;

  type Connector = import("@npc-cli/ui__world/connector").Connector;
  type ConnectorJson = import("@npc-cli/ui__world/assets.schema").ConnectorJson;

  type StarshipSymbolImageKey = import("@npc-cli/media/starship-symbol").StarshipSymbolImageKey;
  type StarShipGeomorphKey = import("@npc-cli/media/starship-symbol").StarShipGeomorphKey;

  type GmData = {
    gmKey: StarShipGeomorphKey;
    doorSegs: { seg: [Geom.Vect, Geom.Vect]; hull: boolean }[];
    polyDecals: Geom.Poly[];
    tops: { [key in "broad" | "nonHullDoor" | "hullDoor" | "hullWall" | "nonHullWall" | "window"]: Geom.Poly[] };
    unseen: boolean;
    wallSegs: { seg: [Geom.Vect, Geom.Vect]; meta: Meta }[];
    wallPolyCount: number;
    wallPolySegCounts: number[];
    /** `poly.lineSegs` rather than `connector.seg`  */
    windowSegs: { seg: [Geom.Vect, Geom.Vect] }[];
    roomHitCt: CanvasRenderingContext2D;
    /** Graph of rooms and doors within geomorph */
    roomGraph: import("./service/room-graph").RoomGraph;
  };

  interface GmRoomId {
    /** gmRoomKey `g{gmId}r${roomId}` */
    grKey: Geomorph.GmRoomKey;
    gmId: number;
    roomId: number;
  }

  interface GmDoorId {
    /** gmDoorKey `g{gmId}d${doorId}` */
    gdKey: GmDoorKey;
    gmId: number;
    doorId: number;
  }

  /** `g${gmId}r${roomId}` */
  type GmRoomKey = `g${number}r${number}`;

  /** `g${gmId}d${doorId}` */
  type GmDoorKey = `g${number}d${number}`;

  /** `g${gmId}w${windowId}` */
  type GmWindowKey = `g${number}w${number}`;

  //#region decor

  type Decor = import("./decor.schema").Decor;
  type DecorDef = import("./decor.schema").DecorDef;

  type DecorPoint = Extract<Decor, { type: "point" }>;
  type DecorRect = Extract<Decor, { type: "rect" }>;
  type DecorCircle = Extract<Decor, { type: "circle" }>;
  type DecorQuad = Extract<Decor, { type: "quad" }>;

  type DecorSheetRectCtxt = Meta<{
    decorImgKey: string;
    /** 0-based index of sheet */
    sheetId: number;
  }>;

  /** `byGrid[x][y]` */
  type DecorGrid = { [gridKey: `${number},${number}`]: Set<Geomorph.Decor> };

  type DecorGridQueryOpts = {
    /** Restrict by room id? */
    grKey?: Geomorph.GmRoomKey;
    /** Extend by extant meta.reachRect? */
    reachRect?: boolean;
  };

  /** Previously we sorted its groups e.g. "points" */
  type RoomDecor = Set<Geomorph.Decor>;

  //#endregion

  // type ObstacleKey = import("@npc-cli/ui__world/assets.schema").ObstacleKey;
  // type ObstacleSheetRectCtxt = import("@npc-cli/ui__world/assets.schema").ObstacleSheetRectCtxt;

  type GmIdGrid = { [gridKey in `${number},${number}`]: number };

  type HullDoorMeta = Meta<{ edge: Geom.DirectionString }>;

  type DoorState = Geomorph.GmDoorId & {
    /** Dense index into the `doors` InstancedMesh; see `Doors` component's `toInstanceId`/`fromInstanceId` */
    instanceId: number;

    /** Determined purely via (gmKey, doorId) */
    connector: Geomorph.Connector;
    /** Is the door automatic? */
    auto: boolean;
    /** Is this an axis-aligned rectangle? */
    axisAligned: boolean;
    /** Is the door open? */
    open: boolean;
    /** Is the door locked? */
    locked: boolean;
    /** Is the door sealed? */
    sealed: boolean;
    /** Is this a hull door? */
    hull: boolean;

    /** Src of transformed door segment */
    src: Geom.VectJson;
    /** Dst of transformed door segment */
    dst: Geom.VectJson;
    /** Transformed connector.normal */
    normal: Geom.VectJson;
    /** Gap (open region) is at the door.dst end when true, door.src end when false */
    gapAtHighLambda: boolean;

    closeTimeoutId?: number;
  };

  type ToggleDoorOpts = {
    /**
     * Does the instigator exist (not `undefined`) and have access (`true`)?
     */
    access?: boolean;
    /** Is the doorway clear? */
    clear?: boolean;
    /** Should we close the door? */
    close?: boolean;
    /** Should we open door? */
    open?: boolean;
  };

  type ToggleLockOpts = {
    /**
     * Does the instigator exist (not `undefined`) and have access (`true`)?
     */
    access?: boolean;
    /** Should we lock the door? */
    lock?: boolean;
    /** Should we unlock the door? */
    unlock?: boolean;
  };
}
