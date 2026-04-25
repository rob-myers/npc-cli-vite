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
  };

  interface GmRoomId {
    /** gmRoomKey `g{gmId}r${roomId}` */
    grKey: Geomorph.GmRoomKey;
    gmId: number;
    roomId: number;
  }

  /** `g${gmId}r${roomId}` */
  type GmRoomKey = `g${number}r${number}`;

  /** `g${gmId}d${doorId}` */
  type GmDoorKey = `g${number}d${number}`;

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
}
