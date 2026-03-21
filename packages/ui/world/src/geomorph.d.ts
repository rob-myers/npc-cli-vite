declare namespace Geomorph {
  type AssetsType = import("@npc-cli/ui__map-edit/map-node-api").AssetsType;
  type FlatSymbol = import("@npc-cli/ui__map-edit/map-node-api").AssetsFlatSymbol;
  type GeomorphLayout = import("@npc-cli/ui__map-edit/map-node-api").GeomorphLayout;
  type MapDef = import("@npc-cli/ui__map-edit/map-node-api").AssetsMapDef;
  type SubSymbol = import("@npc-cli/ui__map-edit/map-node-api").AssetsSubSymbol;
  type Symbol = import("@npc-cli/ui__map-edit/map-node-api").AssetsSymbol;

  interface ConnectorJson {
    poly: Geom.GeoJsonPolygon;
    /** Points into @see {Geomorph.Layout.navRects} */
    navRectId: number;
    /**
     * `[id of room infront, id of room behind]`
     * where a room is *infront* if `normal` is pointing towards it.
     * Hull doors have exactly one non-null entry.
     */
    roomIds: [null | number, null | number];
  }

  interface GmRoomId {
    /** gmRoomKey `g{gmId}r${roomId}` */
    grKey: Geomorph.GmRoomKey;
    gmId: number;
    roomId: number;
  }

  //#region decor

  /**
   * The actual decor instances in `<Decor>`.
   * - They are serializable.
   * - They're also used to represent un-instantiated layout decor in geomorphs.json.
   */
  type Decor = DecorCircle | DecorCuboid | DecorPoint | DecorQuad | DecorDecal | DecorRect;

  /** Used during runtime creation. */
  type DecorDef = DecorCircleDef | DecorCuboidDef | DecorPointDef | DecorQuadDef | DecorRectDef;

  interface DecorCircle extends BaseDecor, Geom.Circle {
    type: "circle";
  }
  interface DecorCircleDef extends BaseDecorDef, Geom.Circle {
    type: "circle";
  }

  /**
   * Vertices `center.xyz ± extent.xyz` rotated about `center` by `angle`.
   */
  interface DecorCuboid extends BaseDecor {
    type: "cuboid";
    center: import("three").Vector3Like;
    transform: Geom.SixTuple;
  }
  interface DecorCuboidDef extends BaseDecorDef, Geom.RectJson {
    type: "cuboid";
    baseY: number;
    height3d: number;
    transform?: Geom.SixTuple;
  }

  interface DecorPoint extends BaseDecor, Geom.VectJson {
    type: "point";
    /** Orientation in degrees, where the unit vector `(1, 0)` corresponds to `0`  */
    orient: number;
    meta: Meta<Geomorph.GmRoomId & { img?: Key.DecorImg }>;
  }
  interface DecorPointDef extends BaseDecorDef, Geom.VectJson {
    type: "point";
    img?: Key.DecorImg;
    /** Orientation in degrees, where the unit vector `(1, 0)` corresponds to `0`  */
    orient?: number;
    /** Height off ground */
    y3d?: number;
  }

  /** Simple polygon sans holes. */
  interface DecorQuad extends BaseDecor {
    type: "quad";
    transform: Geom.SixTuple;
    center: Geom.VectJson;
    /** Determinant of 2x2 part of `transform` */
    det: number;
    meta: Meta<Geomorph.GmRoomId & { img: Key.DecorImg }>;
  }
  interface DecorQuadDef extends BaseDecorDef, Geom.RectJson {
    type: "quad";
    /** For monochromatic use `"colour-white"` and set `color` option. */
    img: Key.DecorImg;
    /** three.js colour rep */
    color?: string;
    /** Applied before translation `x`, `y` */
    transform?: Geom.SixTuple;
    /** Height off ground */
    y3d?: number;
  }

  type DecorDecal = Omit<DecorQuad, "type"> & {
    type: "decal";
  };

  interface DecorRect extends BaseDecor {
    type: "rect";
    points: Geom.VectJson[];
    /** Center of `new Poly(points)` */
    center: Geom.VectJson;
    /** Radians; makes an `Geom.AngledRect` together with `bounds2d`  */
    angle: number;
  }
  interface DecorRectDef extends BaseDecorDef, Geom.RectJson {
    type: "rect";
    /** Radians; makes an `Geom.AngledRect` together with `bounds2d`  */
    angle?: number;
  }

  interface BaseDecor {
    /** Either auto-assigned e.g. decor from geomorphs, or specified by user. */
    key: string;
    meta: Meta<Geomorph.GmRoomId>;
    /** 2D bounds inside XZ plane */
    bounds2d: Geom.RectJson;
    /** Epoch ms when last updated (overwritten) */
    updatedAt?: number;
    /**
     * Indicates decor that comes from a geomorph layout,
     * i.e. decor that is initially instantiated.
     */
    src?: Key.Geomorph;
    // /** For defining decor via CLI (more succinct) */
    // tags?: string[];
  }
  interface BaseDecorDef {
    key: string;
    meta?: Meta;
  }

  type DecorSheetRectCtxt = Meta<{
    decorImgKey: Key.DecorImg;
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
}
