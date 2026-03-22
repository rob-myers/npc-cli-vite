import { StarShipSymbolImageKeySchema } from "@npc-cli/media/starship-symbol";
import { AffineTransformSchema, PointSchema, RectSchema } from "@npc-cli/util/geom";
import z from "zod";

const BaseNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  locked: z.boolean(),
  visible: z.boolean(),
  transform: AffineTransformSchema,
});
export type BaseMapNode = z.infer<typeof BaseNodeSchema>;

export const MapNodeSchema = z.union([
  BaseNodeSchema.extend({
    type: z.literal("group"),
    get children() {
      return z.array(MapNodeSchema);
    },
  }),
  BaseNodeSchema.extend({
    type: z.literal("rect"),
    baseRect: z.object({ width: z.number(), height: z.number() }),
    cssTransform: z.string(),
  }),
  BaseNodeSchema.extend({
    type: z.literal("image"),
    srcType: z.literal(["symbol", "decor"]).default("symbol"),
    srcKey: z.string().nullable(),
    baseRect: z.object({ width: z.number(), height: z.number() }),
    offset: PointSchema,
    cssTransform: z.string(),
  }),
  BaseNodeSchema.extend({
    type: z.literal("symbol"),
    srcKey: StarShipSymbolImageKeySchema.nullable(),
    baseRect: z.object({ width: z.number(), height: z.number() }),
    offset: PointSchema,
    cssTransform: z.string(),
  }),
  BaseNodeSchema.extend({
    type: z.literal("path"),
    d: z.string(),
    baseRect: z.object({ width: z.number(), height: z.number() }),
    cssTransform: z.string(),
  }),
]);

export type MapNode = z.infer<typeof MapNodeSchema>;
export type MapNodeType = MapNode["type"];
export type RectMapNode = Pretty<Extract<MapNode, { type: "rect" }>>;
export type GroupMapNode = Pretty<Extract<MapNode, { type: "group" }>>;
export type ImageMapNode = Pretty<Extract<MapNode, { type: "image" }>>;
export type DecorImageMapNode = Pretty<ImageMapNode & { srcType: "decor" }>;
export type PathMapNode = Pretty<Extract<MapNode, { type: "path" }>>;
export type SymbolMapNode = Pretty<Extract<MapNode, { type: "symbol" }>>;
export type TransformableMapNode = Extract<MapNode, { type: "rect" | "image" | "symbol" | "path" }>;
export type BaseRect = { width: number; height: number };
export type Transform = z.infer<typeof AffineTransformSchema>;
export type MapNodeByType<T extends MapNodeType> = Pretty<Extract<MapNode, { type: T }>>;
export type MapNodeMap = { [T in MapNodeType]: MapNodeByType<T> };

export function isDecorImageMapNode(node: MapNode): node is DecorImageMapNode {
  return node.type === "image" && node.srcType === "decor";
}

export const SymbolKeySchema = StarShipSymbolImageKeySchema;
export const SymbolJsonFilenameSchema = z.templateLiteral([SymbolKeySchema, ".json"]);
/** AKA `StarShipSymbolImageKey` */
export type SymbolKey = z.infer<typeof StarShipSymbolImageKeySchema>;

export const MapKeySchema = z.string();
export const MapJsonFilenameSchema = MapKeySchema.endsWith(".json");

export const MapEditSymbolFileSpecifierSchema = z.object({
  type: z.literal("symbol"),
  filename: SymbolJsonFilenameSchema,
  key: StarShipSymbolImageKeySchema,
});
export const MapEditMapFileSpecifierSchema = z.object({
  type: z.literal("map"),
  filename: MapJsonFilenameSchema,
  key: z.string(),
});
export const MapEditFileSpecifierSchema = z.union([MapEditSymbolFileSpecifierSchema, MapEditMapFileSpecifierSchema]);
export type MapEditFileSpecifier = z.infer<typeof MapEditFileSpecifierSchema>;

const MapEditSavedBaseSchema = z.object({
  filename: z.string(),
  width: z.number(),
  height: z.number(),
  nodes: z.array(MapNodeSchema),
  bounds: RectSchema,
});

export const MapEditSavedSymbolSchema = MapEditSavedBaseSchema.extend(MapEditSymbolFileSpecifierSchema.shape);
export const MapEditSavedMapSchema = MapEditSavedBaseSchema.extend(MapEditMapFileSpecifierSchema.shape);
export const MapEditSavedFileSchema = z.union([MapEditSavedSymbolSchema, MapEditSavedMapSchema]);

export type MapEditSavedFile = z.infer<typeof MapEditSavedFileSchema>;
export type MapEditSavedSymbol = z.infer<typeof MapEditSavedSymbolSchema>;
export type MapEditSavedMap = z.infer<typeof MapEditSavedMapSchema>;
export type UiIdToCurrentFileSpecifer = Record<string, MapEditFileSpecifier>;

const BaseManifestItemSchema = z.object({
  filename: z.string(),
  thumbnailFilename: z.string(),
  width: z.number(),
  height: z.number(),
  bounds: RectSchema,
});

export const SymbolsManifestItemSchema = BaseManifestItemSchema.extend(MapEditSymbolFileSpecifierSchema.shape);

export const SymbolsManifestSchema = z.object({
  modifiedAt: z.string(),
  byKey: z.partialRecord(StarShipSymbolImageKeySchema, SymbolsManifestItemSchema),
});

export const MapsManifestItemSchema = BaseManifestItemSchema.extend(MapEditMapFileSpecifierSchema.shape);

export const MapsManifestSchema = z.object({
  modifiedAt: z.string(),
  byKey: z.record(z.string(), MapsManifestItemSchema),
});

export const PathManifestEntrySchema = z.object({
  key: z.string(),
  filename: z.string(),
  pathCount: z.number(),
  width: z.number(),
  height: z.number(),
});

export const PathManifestSchema = z.object({
  modifiedAt: z.string(),
  byKey: z.record(z.string(), PathManifestEntrySchema),
});

export const DecorManifestEntrySchema = z.object({
  key: z.string(),
  filename: z.string(),
  width: z.number(),
  height: z.number(),
});

export const DecorManifestSchema = z.object({
  modifiedAt: z.string(),
  byKey: z.record(z.string(), DecorManifestEntrySchema),
});

export type SymbolsManifest = z.infer<typeof SymbolsManifestSchema>;
export type MapsManifest = z.infer<typeof MapsManifestSchema>;
export type PathManifest = z.infer<typeof PathManifestSchema>;
export type DecorManifest = z.infer<typeof DecorManifestSchema>;
