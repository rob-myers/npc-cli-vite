import { SymbolGraphNodeSchema } from "@npc-cli/graph";
import {
  StarShipGeomorphKeySchema,
  StarShipGeomorphNumberSchema,
  StarShipSymbolImageKeySchema,
} from "@npc-cli/media/starship-symbol";
import { MapKeySchema } from "@npc-cli/ui__map-edit/editor.schema";
import {
  AffineTransformSchema,
  GeoJsonPolygonSchema,
  MetaSchema,
  matCodec,
  pointCodec,
  polyCodec,
  rectCodec,
  TriangulationSchema,
} from "@npc-cli/util/geom";
import { Matrix4 } from "three/src/math/Matrix4.js";
import z from "zod";
import { DecorPointSchema, DecorSchema } from "./decor.schema.ts";
import { Connector } from "./service/Connector.ts";

export const ConnectorJsonSchema = z.object({
  poly: GeoJsonPolygonSchema,
  /** Points into @see {Geomorph.Layout.navRects} */
  navRectId: z.number(),
  /**
   * `[id of room infront, id of room behind]`
   * where a room is *infront* if `normal` is pointing towards it.
   * Hull doors have exactly one non-null entry.
   */
  roomIds: z.tuple([z.number().nullable(), z.number().nullable()]),
});
export type ConnectorJson = z.infer<typeof ConnectorJsonSchema>;

export const ConnectorSchema = z.instanceof(Connector);

export const connectorCodec = z.codec(ConnectorJsonSchema, ConnectorSchema, {
  decode: (json) => Connector.from(json),
  encode: (connector) => connector.json,
});

export const AssetsFlatSymbolSchema = z.object({
  key: StarShipSymbolImageKeySchema,
  isHull: z.boolean(),
  width: z.number(),
  height: z.number(),
  bounds: rectCodec,

  decor: z.array(polyCodec),
  doors: z.array(polyCodec),
  obstacles: z.array(polyCodec),
  unsorted: z.array(polyCodec),
  /** All walls including hull walls */
  walls: z.array(polyCodec),
  windows: z.array(polyCodec),
});
export type AssetsFlatSymbol = z.infer<typeof AssetsFlatSymbolSchema>;
export type SymbolPolysKey = keyof Omit<AssetsSymbol, "key" | "isHull" | "width" | "height" | "bounds" | "symbols">;

export const AssetsSubSymbolSchema = z.object({
  symbolKey: StarShipSymbolImageKeySchema,
  /** Original width (Starship Symbols coordinates i.e. 60 ~ 1 grid) */
  width: z.number(),
  /** Original height (Starship Symbols coordinates i.e. 60 ~ 1 grid) */
  height: z.number(),
  transform: AffineTransformSchema,
  meta: z.record(z.string(), z.any()),
});
export type AssetsSubSymbol = z.infer<typeof AssetsSubSymbolSchema>;

export const AssetsSymbolSchema = AssetsFlatSymbolSchema.extend({
  /** Usually from hull symbols but also in lifeboat */
  hullWalls: z.array(polyCodec),
  symbols: z.array(AssetsSubSymbolSchema),
});
export type AssetsSymbol = z.infer<typeof AssetsSymbolSchema>;

export const GeomorphLayoutObstacleSchema = z.object({
  /** The `symbol` the obstacle originally comes from */
  symbolKey: StarShipSymbolImageKeySchema,
  /** The index in `symbol.obstacles` this obstacle corresponds to */
  obstacleId: z.number(),
  /** The height of this particular instance */
  height: z.number(),
  /** `symbol.obstacles[obstacleId]` -- could be inferred from `assets` */
  origPoly: polyCodec,
  /** Subrect of original symbol's image for UV computation later */
  origSubRect: rectCodec,
  /** Transform from original symbol into Geomorph (meters) */
  transform: AffineTransformSchema,
  /** `origPoly.center` transformed by `transform` */
  center: pointCodec,
  /** Shortcut to `origPoly.meta` */
  meta: MetaSchema,
});
export type GeomorphLayoutObstacle = z.infer<typeof GeomorphLayoutObstacleSchema>;

export const GeomorphLayoutSchema = z.object({
  key: StarShipGeomorphKeySchema,
  num: StarShipGeomorphNumberSchema,
  bounds: rectCodec,

  decor: z.array(DecorSchema),
  doors: z.array(connectorCodec),
  hullDoors: z.array(connectorCodec),
  hullPoly: z.array(polyCodec),
  labels: z.array(DecorPointSchema),
  obstacles: z.array(GeomorphLayoutObstacleSchema),
  rooms: z.array(polyCodec),
  unsorted: z.array(polyCodec),
  walls: z.array(polyCodec),
  windows: z.array(connectorCodec),

  navDecomp: TriangulationSchema,
  /** AABBs of `navPolyWithDoors` i.e. original nav-poly */
  navRects: z.array(rectCodec),
});
export type GeomorphLayout = z.infer<typeof GeomorphLayoutSchema>;

export const AssetsMapDefSchema = z.object({
  key: MapKeySchema,
  gms: z.array(
    z.object({
      gmKey: StarShipGeomorphKeySchema,
      transform: AffineTransformSchema,
    }),
  ),
});
export type AssetsMapDef = z.infer<typeof AssetsMapDefSchema>;

export const AssetsSymbolLookupSchema = z.partialRecord(StarShipSymbolImageKeySchema, AssetsSymbolSchema);
export type AssetsSymbolLookup = z.infer<typeof AssetsSymbolLookupSchema>;

export const WorldThemeSchema = z.object({
  background: z.string(),
  ceiling: z.object({
    hull: z.object({ fill: z.string(), stroke: z.string() }),
    nonHull: z.object({ fill: z.string(), stroke: z.string() }),
  }),
  walls: z
    .object({
      color: z.string().default("#000000"),
      opacity: z.number().min(0).max(1).default(0.5),
    })
    .default({ color: "#000000", opacity: 0.5 }),
});
export type WorldTheme = z.infer<typeof WorldThemeSchema>;

export const AssetsSchema = z.object({
  symbol: AssetsSymbolLookupSchema,
  map: z.partialRecord(MapKeySchema, AssetsMapDefSchema),
  flattened: z.partialRecord(StarShipSymbolImageKeySchema, AssetsFlatSymbolSchema),
  stratifiedSymbolNodes: z.array(z.array(SymbolGraphNodeSchema)),
  layout: z.partialRecord(StarShipGeomorphKeySchema, GeomorphLayoutSchema),
  theme: z.partialRecord(z.string(), WorldThemeSchema),
  hash: z.object({
    /** Over all symbols */
    obstacles: z.number(),
  }),
});
export type AssetsType = z.infer<typeof AssetsSchema>;

export const GeomorphLayoutInstanceSchema = GeomorphLayoutSchema.extend({
  gmId: z.number(),
  transform: AffineTransformSchema,
  matrix: matCodec,
  gridRect: rectCodec,
  inverseMatrix: matCodec,
  mat4: z.instanceof(Matrix4),
  determinant: z.number(),

  /** `getOtherRoomId(doorId: number, roomId: number): number` */
  getOtherRoomId: z.function({ input: [z.number(), z.number()], output: z.number() }),
  /** `isHullDoor(doorId: number): boolean` */
  isHullDoor: z.function({ input: [z.number()], output: z.boolean() }),
});
export type GeomorphLayoutInstance = z.infer<typeof GeomorphLayoutInstanceSchema>;

// 🚧 TODO use during assets.json build?
// export const ObstacleKeySchema = z.templateLiteral([StarShipSymbolImageKeySchema, z.literal(" "), z.number()]);
// export type ObstacleKey = z.infer<typeof ObstacleKeySchema>;
// export const ObstacleSheetRectCtxtSchema = z.object({
//   symbolKey: StarShipSymbolImageKeySchema,
//   /**
//    * Index inside symbol (0-based)
//    * _NOTE_: often only one obstacle in a given symbol
//    */
//   obstacleId: z.number(),
//   /** Spritesheet id (0-based) */
//   sheetId: z.number(),
//   /** e.g. `chair` */
//   type: z.string(),
// });
// export type ObstacleSheetRectCtxt = z.infer<typeof ObstacleSheetRectCtxtSchema>;

export const StarShipSymbolSheetDatumSchema = z.object({
  key: StarShipSymbolImageKeySchema,
  group: z.string(),
});
export type StarShipSymbolSheetDatum = z.infer<typeof StarShipSymbolSheetDatumSchema>;

export const StarShipSymbolSheetEntrySchema = z.object({
  key: StarShipSymbolImageKeySchema,
  rect: rectCodec,
  sheetId: z.number(),
});
export type StarShipSymbolSheetEntry = z.infer<typeof StarShipSymbolSheetEntrySchema>;

/**
 * For public/sheets.json
 */
export const SheetsSchema = z.object({
  /**
   * Over all sheets
   * - key format `{symbolKey} ${obstacleId}`
   * - `rect` in Starship Geomorphs Units (sgu), possibly scaled-up for higher-res images
   */
  symbol: z.partialRecord(StarShipSymbolImageKeySchema, StarShipSymbolSheetEntrySchema),
  /** Aligned to sheets; its length is the number of the sheets. */
  symbolSheetDims: z.array(z.object({ width: z.number(), height: z.number() })),
  /** Maximum over all sheets, for texture array */
  maxSymbolSheetDim: z.object({ width: z.number(), height: z.number() }),
});
export type SheetsType = z.infer<typeof SheetsSchema>;
