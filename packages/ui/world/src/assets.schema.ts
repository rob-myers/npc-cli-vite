import {
  StarShipGeomorphKeySchema,
  StarShipGeomorphNumberSchema,
  StarShipSymbolImageKeySchema,
} from "@npc-cli/media/starship-symbol";
import { MapKeySchema } from "@npc-cli/ui__map-edit/editor.schema";
import {
  AffineTransformSchema,
  CoordSchema,
  MetaSchema,
  PointSchema,
  Poly,
  RectSchema,
  TriangulationSchema,
} from "@npc-cli/util/geom";
import z from "zod";
import { DecorPointSchema, DecorSchema } from "./decor.schema";
import { Connector } from "./service/Connector";

export const ConnectorSchema = z.instanceof(Connector);

export const GeoJsonPolygonSchema = z.object({
  type: z.literal("Polygon"),
  /**
   * The 1st array defines the _outer polygon_,
   * the others define non-nested _holes_.
   */
  coordinates: z.array(z.array(CoordSchema)),
  meta: z.record(z.string(), z.any()),
});
export type GeoJsonPolygon = z.infer<typeof GeoJsonPolygonSchema>;
export const PolySchema = z.instanceof(Poly);
export const polyCodec = z.codec(GeoJsonPolygonSchema, PolySchema, {
  decode: (geoJson) => Poly.from(geoJson),
  encode: (poly) => poly.geoJson,
});

export const AssetsFlatSymbolSchema = z.object({
  key: StarShipSymbolImageKeySchema,
  isHull: z.boolean(),
  width: z.number(),
  height: z.number(),
  bounds: RectSchema,

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
  /** Transform from original symbol into Geomorph (meters) */
  transform: AffineTransformSchema,
  /** `origPoly.center` transformed by `transform` */
  center: PointSchema,
  /** Shortcut to `origPoly.meta` */
  meta: MetaSchema,
});
export type GeomorphLayoutObstacle = z.infer<typeof GeomorphLayoutObstacleSchema>;

export const GeomorphLayoutSchema = z.object({
  key: StarShipGeomorphKeySchema,
  num: StarShipGeomorphNumberSchema,
  bounds: RectSchema,

  decor: z.array(DecorSchema),
  doors: z.array(ConnectorSchema),
  hullDoors: z.array(ConnectorSchema),
  hullPoly: z.array(polyCodec),
  labels: z.array(DecorPointSchema),
  obstacles: z.array(GeomorphLayoutObstacleSchema),
  rooms: z.array(polyCodec),
  unsorted: z.array(polyCodec),
  walls: z.array(polyCodec),
  windows: z.array(ConnectorSchema),

  navDecomp: TriangulationSchema,
  /** AABBs of `navPolyWithDoors` i.e. original nav-poly */
  navRects: z.array(RectSchema),
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

export const AssetsSchema = z.object({
  symbol: z.partialRecord(StarShipSymbolImageKeySchema, AssetsSymbolSchema),
  map: z.partialRecord(MapKeySchema, AssetsMapDefSchema),
  flattened: z.partialRecord(StarShipSymbolImageKeySchema, AssetsFlatSymbolSchema),
  layout: z.partialRecord(StarShipGeomorphKeySchema, GeomorphLayoutSchema),
});
export type AssetsType = z.infer<typeof AssetsSchema>;
