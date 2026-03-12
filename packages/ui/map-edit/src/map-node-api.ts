import { StarShipSymbolImageKeySchema, type StarshipSymbolImageKey } from "@npc-cli/media/starship-symbol";
import { ExhaustiveError } from "@npc-cli/util/exhaustive-error";
import { Mat, Poly, Rect } from "@npc-cli/util/geom";
import { keys, tryLocalStorageGetParsed, warn } from "@npc-cli/util/legacy/generic";
import z from "zod";

//#region schemas

const PointSchema = z.object({
  x: z.number(),
  y: z.number(),
});

const CoordSchema = z.tuple([z.number(), z.number()]);

const BaseRectSchema = z.object({
  width: z.number(),
  height: z.number(),
});
const RectSchema = BaseRectSchema.extend(PointSchema.shape);
const TransformSchema = z.object({
  a: z.number(),
  b: z.number(),
  c: z.number(),
  d: z.number(),
  e: z.number(),
  f: z.number(),
});

const BaseNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  locked: z.boolean(),
  visible: z.boolean(),
  transform: TransformSchema,
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
    srcKey: StarShipSymbolImageKeySchema.nullable(),
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
export type TransformableMapNode = Extract<MapNode, { type: "rect" | "image" | "symbol" | "path" }>;
export type BaseRect = { width: number; height: number };
export type Transform = z.infer<typeof TransformSchema>;
export type MapNodeByType<T extends MapNodeType> = Pretty<Extract<MapNode, { type: T }>>;
export type MapNodeMap = { [T in MapNodeType]: MapNodeByType<T> };

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

export type SymbolsManifest = z.infer<typeof SymbolsManifestSchema>;
export type MapsManifest = z.infer<typeof MapsManifestSchema>;
export type PathManifest = z.infer<typeof PathManifestSchema>;

//#endregion

//#region assets schemas

export const GeoJsonPolygonSchema = z.object({
  /** Identifier amongst GeoJSON formats. */
  type: z.literal("Polygon"),
  /**
   * The 1st array defines the _outer polygon_,
   * the others define non-nested _holes_.
   */
  coordinates: z.array(z.array(CoordSchema)),
  meta: z.record(z.string(), z.string()),
});

export type GeoJsonPolygon = z.infer<typeof GeoJsonPolygonSchema>;

export const PolySchema = z.instanceof(Poly);

export const polyCodec = z.codec(GeoJsonPolygonSchema, PolySchema, {
  decode: (geoJson) => Poly.from(geoJson),
  encode: (poly) => poly.geoJson,
});

export const AssetsSymbolSchema = z.object({
  key: StarShipSymbolImageKeySchema,
  filename: SymbolJsonFilenameSchema,
  isHull: z.boolean(),
  width: z.number(),
  height: z.number(),
  bounds: RectSchema,

  // 🚧
  walls: z.array(GeoJsonPolygonSchema),
});

export const AssetsSchema = z.object({
  symbol: z.partialRecord(StarShipSymbolImageKeySchema, AssetsSymbolSchema),
});

//#endregion

//#region constants

const defaultBaseRect: BaseRect = { width: 60, height: 60 };
const defaultPoint: Geom.VectJson = { x: 0, y: 0 };
const idTransform: Transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

const mockBaseNode: BaseMapNode = {
  id: "mock-id",
  name: "New Node",
  locked: false,
  visible: true,
  transform: { ...idTransform },
};

export const templateNodeByKey = {
  group: { ...mockBaseNode, type: "group", children: [] as MapNode[] },
  image: {
    ...mockBaseNode,
    type: "image",
    srcKey: null,
    baseRect: defaultBaseRect,
    offset: defaultPoint,
    cssTransform: "matrix(1, 0, 0, 1, 0, 0)",
  },
  rect: {
    ...mockBaseNode,
    type: "rect",
    baseRect: defaultBaseRect,
    cssTransform: "translate(0px, 0px) scale(1)",
  },
  symbol: {
    ...mockBaseNode,
    type: "symbol",
    srcKey: null,
    baseRect: defaultBaseRect,
    offset: defaultPoint,
    cssTransform: "matrix(1, 0, 0, 1, 0, 0)",
  },
  path: {
    ...mockBaseNode,
    type: "path",
    d: "",
    baseRect: defaultBaseRect,
    cssTransform: "matrix(1, 0, 0, 1, 0, 0)",
  },
} satisfies Record<MapNodeType, MapNode>;

export const mapNodeTypes = keys({
  group: true,
  image: true,
  path: true,
  rect: true,
  symbol: true,
} satisfies Record<MapNodeType, true>);

export const baseSvgSize = 600;

export const labelledImageOffsetValue = {
  zero: 0,
  centerExtra003: -0.3,
  halfLineWidth: -0.7,
  eastAlignBed004: -3.7,
  centerXConsole051: 1.3,
  centerYStateRoom012: 2,
  centerXExtra004: -3,
} as const;

export const imageOffsetValues = Object.values(labelledImageOffsetValue)
  .flatMap((x) => (x === 0 ? 0 : [Math.abs(x), -Math.abs(x)]))
  .sort();

export const ALLOWED_MAP_EDIT_FOLDERS = ["symbol", "map"] as const;

export const LOCAL_STORAGE_PREFIX = "map-edit:";
export const LOCAL_STORAGE_UI_ID_TO_FILE_SPECIFIER = "map-edit-to-current-file";

export const defaultSymbolKey: StarshipSymbolImageKey = "stateroom--012--2x2";

export const devMessageFromServer = {
  recomputedPathManifest: "map-edit:recompute-path-manifest",
} as const;

//#endregion

//#region node apis

/** Find node and its parent */
export function findNode(
  /** Either top-level nodes or `group.childrem` */
  parentArray: MapNode[],
  id: string,
  parent: GroupMapNode | null = null,
): [node: MapNode | null, parent: null | GroupMapNode] {
  for (const child of parentArray) {
    if (child.id === id) {
      return [child, parent];
    }
    if (child.type === "group") {
      const result = findNode(child.children, id, child);
      if (result[0] !== null) return result;
    }
  }
  return [null, null];
}

export function findNodeWithDepth(
  parentArray: MapNode[],
  id: string,
  parent: GroupMapNode | null = null,
  depth = 0,
): { node: MapNode; parent: null | GroupMapNode; depth: number } | null {
  for (const child of parentArray) {
    if (child.id === id) return { node: child, parent, depth };
    if (child.type === "group") {
      const result = findNodeWithDepth(child.children, id, child, depth + 1);
      if (result) return result;
    }
  }
  return null;
}

export function getRecursiveNodes(nodes: MapNode[]) {
  const recursiveNodes = new Set<MapNode>();
  traverseNodesSync(nodes, (node) => void recursiveNodes.add(node));
  return recursiveNodes;
}

/** Compute the world-space bounds of a rect/image node */
export function getNodeBounds(...nodes: MapNode[]): Geom.RectJson {
  if (nodes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };

  const node = nodes.length === 1 ? nodes[0] : ({ type: "group", children: nodes } as GroupMapNode);

  switch (node.type) {
    case "group": {
      return node.children.reduce((bounds, child) => bounds.union(getNodeBounds(child)), new Rect()).json;
    }
    case "rect": {
      return {
        x: node.transform.e,
        y: node.transform.f,
        // (a,0,0,d,e,f) since rotation not allowed
        width: node.baseRect.width * node.transform.a,
        height: node.baseRect.height * node.transform.d,
      };
    }
    case "path":
    case "image":
    case "symbol": {
      const { a, b, c, d, e, f } = new DOMMatrix(node.cssTransform);
      const m = new Mat([a, b, c, d, e, f]);
      const baseRect = new Rect(0, 0, node.baseRect.width, node.baseRect.height);
      return baseRect.applyMatrix(m).json;
    }
    default:
      throw new ExhaustiveError(node);
  }
}

export function insertNodeAt(srcNode: MapNode, dstArray: MapNode[], dstChildId: string, edge: "top" | "bottom"): void {
  const index = dstArray.findIndex((n) => n.id === dstChildId);
  if (index === -1) throw Error(`Expected id ${dstChildId} in ${JSON.stringify(dstArray)}`);
  const idx = edge === "top" ? index : index + 1;
  dstArray.splice(idx, 0, srcNode);
}

export function isNodeReflectable(node: MapNode | null): node is TransformableMapNode {
  return node !== null && (node.type === "symbol" || node.type === "path");
}

export function isNodeTransformable(node: MapNode | null): node is TransformableMapNode {
  return node !== null && node.type !== "group";
}

const namePreservesRegexes = ["wall", "door", "obstacle"].map((type) => new RegExp(`^${type}(\\s|$)`));

export function shouldUseOriginalName(node: MapNode): boolean {
  return node.type === "symbol" || node.type === "path" || namePreservesRegexes.some((re) => re.test(node.name));
}

export function mapNodes(list: MapNode[], id: string, fn: (el: MapNode) => MapNode): MapNode[] {
  return list.map((item) => {
    if (item.id === id) return fn(item);
    if (item.type === "group") return { ...item, children: mapNodes(item.children, id, fn) };
    return item;
  });
}

export function computeNodeCssTransform(node: TransformableMapNode): string {
  switch (node.type) {
    case "rect":
      return computeRectCssTransform(node);
    case "path":
      return computePathCssTransform(node);
    case "image":
    case "symbol":
      return computeImageCssTransform(node);
    default:
      throw new ExhaustiveError(node);
  }
}

/**
 * Compute CSS transform string for an image node.
 */
function computeImageCssTransform(node: Extract<MapNode, { type: "image" | "symbol" }>): string {
  const { transform, offset } = node;
  return `matrix(${transform.a}, ${transform.b}, ${transform.c}, ${transform.d}, ${transform.e + offset.x}, ${transform.f + offset.y})`;
}

function computePathCssTransform(node: Extract<MapNode, { type: "path" }>): string {
  const { transform } = node;
  return `matrix(${transform.a}, ${transform.b}, ${transform.c}, ${transform.d}, ${transform.e}, ${transform.f})`;
}

function computeRectCssTransform(node: Extract<MapNode, { type: "rect" }>): string {
  return `matrix(1, 0, 0, 1, ${node.transform.e}, ${node.transform.f})`;
}

/** Returns index of child before it was removed */
export function removeNodeFromParent(parentArray: MapNode[], childId: string) {
  const index = parentArray.findIndex((n) => n.id === childId);
  if (index === -1) throw Error(`Expected id ${childId} in ${JSON.stringify(parentArray)}`);
  parentArray.splice(index, 1);
  return index;
}

export function traverseNodesSync(list: MapNode[], act: (el: MapNode) => void) {
  for (const item of list) {
    act(item);
    if (item.type === "group") traverseNodesSync(item.children, act);
  }
}

export async function traverseNodesAsync(list: MapNode[], act: (el: MapNode) => Promise<void>) {
  for (const item of list) {
    await act(item);
    if (item.type === "group") await traverseNodesAsync(item.children, act);
  }
}

export function isSavableFileType(type: string): type is MapEditSavedFile["type"] {
  return ALLOWED_MAP_EDIT_FOLDERS.includes(type as MapEditSavedFile["type"]);
}

export function getFileSpecifierLocalStorageKey(file: MapEditFileSpecifier) {
  return `${LOCAL_STORAGE_PREFIX}${file.type}:${file.filename}`;
}

export function tryDecodeFileSpecifierLocalStorageKey(localStorageKey: string): MapEditFileSpecifier | null {
  const [, type, filename] = localStorageKey.split(/[:]/);
  const result = MapEditFileSpecifierSchema.safeParse({ type, filename, key: filename.replace(/\.json$/, "") });
  return result.data ?? null;
}

export function getLocalStorageSavedFiles(): MapEditFileSpecifier[] {
  const files: MapEditFileSpecifier[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(LOCAL_STORAGE_PREFIX)) {
      const fileSpec = tryDecodeFileSpecifierLocalStorageKey(key);
      if (fileSpec) files.push(fileSpec);
      else warn(`Invalid localStorage key "${key}" found for MapEdit - skipping`);
    }
  }
  return files.sort((a, b) => a.filename.localeCompare(b.filename));
}

export function clearLocalStorage() {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(LOCAL_STORAGE_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((key) => localStorage.removeItem(key));
  localStorage.removeItem(LOCAL_STORAGE_UI_ID_TO_FILE_SPECIFIER);
}

export function areFileSpecifiersEqual(a: MapEditFileSpecifier, b: MapEditFileSpecifier): boolean {
  return a.type === b.type && a.filename === b.filename;
}

export function extendCurrentFileSpecifierMapping(
  uiId: string,
  fileSpecifier: MapEditFileSpecifier,
): UiIdToCurrentFileSpecifer {
  return {
    ...tryLocalStorageGetParsed<UiIdToCurrentFileSpecifer>(LOCAL_STORAGE_UI_ID_TO_FILE_SPECIFIER),
    [uiId]: fileSpecifier,
  };
}

/**
 * ⚠️ Used to fix saved files as we migrate schemas.
 * ⚠️ "Blank drafts" can be fixed by clearing localStorage and re-opening the file.
 *
 * - 1. Added `key` field which is derived from `filename`.
 *
 */
export function migrateMapEditSavedFile(savedFile: MapEditSavedFile): MapEditSavedFile {
  return savedFile;
}

//#endregion
