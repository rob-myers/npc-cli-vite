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

  type Decor = import("@npc-cli/ui__map-edit/map-node-api").Decor;
  type DecorDef = import("@npc-cli/ui__map-edit/map-node-api").DecorDef;

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

  type ObstacleKey = import("@npc-cli/ui__world/assets.schema").ObstacleKey;

  // type ObstacleSheetRectCtxt = import("@npc-cli/ui__world/assets.schema").ObstacleSheetRectCtxt;

  type GmIdGrid = { [gridKey in `${number},${number}`]: number };

  type HullDoorMeta = Meta<{ edge: Geom.DirectionString }>;

  // 🚧
  interface DoorState extends Geomorph.GmDoorId {
    /** gmDoorKey format i.e. `g{gmId}d{doorId}` */
    gdKey: GmDoorKey;
    door: Geomorph.Connector;
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

    /** Between `0.1` (open) and `1` (closed) */
    ratio: number;
    /** Src of transformed door segment */
    src: Geom.VectJson;
    /** Dst of transformed door segment */
    dst: Geom.VectJson;
    /** Center of transformed door */
    center: Geom.Vect;
    /** Direction of transformed door segment */
    dir: Geom.VectJson;
    normal: Geom.VectJson;
    /** Length of `door.seg` */
    segLength: number;
    /** 1st entrance pointed to by `normal` */
    entrances: [Geom.Seg, Geom.Seg];
    /**
     * Added to exits (a point on a segment door.entrances[i]) to compute "far exit".
     * Used to avoid NPCs blocking the door.
     */
    farDeltas: [Geom.VectJson, Geom.VectJson];
    /** As wide as door, slightly less deep than doorway. */
    collidePoly: Geom.Poly;
    /** Bounds of `doorway`. */
    collideRect: Geom.Rect;

    closeTimeoutId?: number;
  }
}
