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
    tops: { broad: Geom.Poly[]; hull: Geom.Poly[]; nonHull: Geom.Poly[]; window: Geom.Poly[] };
    unseen: boolean;
    wallSegs: { seg: [Geom.Vect, Geom.Vect]; meta: Meta }[];
    wallPolyCount: number;
    wallPolySegCounts: number[];
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
  type DecorCuboid = Extract<Decor, { type: "cuboid" }>;
  type DecorRect = Extract<Decor, { type: "rect" }>;
  type DecorCircle = Extract<Decor, { type: "circle" }>;
  type DecorQuad = Extract<Decor, { type: "quad" }>;
  type DecorDecal = Extract<Decor, { type: "decal" }>;

  type DecorSheetRectCtxt = Meta<{
    decorImgKey: string;
    /** 0-based index of sheet */
    sheetId: number;
  }>;

  /** `byGrid[x][y]` */
  type DecorGrid = { [gridKey: `${number},${number}`]: Set<Geomorph.Decor> };

  type DecorGridQueryOpts = {
    grKey?: Geomorph.GmRoomKey;
    reachRect?: boolean;
  };

  /** Previously we sorted its groups e.g. "points" */
  type RoomDecor = Set<Geomorph.Decor>;

  //#endregion

  // type ObstacleKey = import("@npc-cli/ui__world/assets.schema").ObstacleKey;
  // type ObstacleSheetRectCtxt = import("@npc-cli/ui__world/assets.schema").ObstacleSheetRectCtxt;

  type GmIdGrid = { [gridKey in `${number},${number}`]: number };

  type HullDoorMeta = Meta<{ edge: Geom.DirectionString }>;

  interface DoorState extends Geomorph.GmDoorId {
    /** gmId << 8 + doorId */
    instanceId: number;

    /** Determined purely via (gmKey, doorId) */
    connector: Geomorph.Connector;
    /** instancedMesh */
    instanceId: number;
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
  }
}
