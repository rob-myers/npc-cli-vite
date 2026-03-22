import {
  StarShipGeomorphKeySchema,
  StarShipGeomorphNumberSchema,
  StarShipSymbolImageKeySchema,
  type StarshipSymbolImageKey,
} from "@npc-cli/media/starship-symbol";
import { Connector } from "@npc-cli/ui__world/connector";
import { ExhaustiveError } from "@npc-cli/util/exhaustive-error";
import {
  AffineTransformSchema,
  CoordSchema,
  Mat,
  MetaSchema,
  PointSchema,
  Poly,
  Rect,
  RectSchema,
} from "@npc-cli/util/geom";
import { keys, tryLocalStorageGetParsed, warn } from "@npc-cli/util/legacy/generic";
import z from "zod";
import {
  type BaseMapNode,
  type BaseRect,
  type GroupMapNode,
  type MapEditFileSpecifier,
  MapEditFileSpecifierSchema,
  type MapEditSavedFile,
  MapKeySchema,
  type MapNode,
  type MapNodeType,
  type Transform,
  type TransformableMapNode,
  type UiIdToCurrentFileSpecifer,
} from "./editor.schema.ts";

//#region decor schemas

const SixTupleSchema = z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]);
const Vector3LikeSchema = z.object({ x: z.number(), y: z.number(), z: z.number() });
const GmRoomIdSchema = z.object({
  grKey: z.string(),
  gmId: z.number(),
  roomId: z.number(),
});

const BaseDecorSchema = z.object({
  key: z.string(),
  meta: MetaSchema.and(GmRoomIdSchema),
  bounds2d: RectSchema,
  updatedAt: z.number().optional(),
  src: StarShipGeomorphKeySchema.optional(),
});

const BaseDecorDefSchema = z.object({
  key: z.string(),
  meta: MetaSchema.optional(),
});

export const DecorCircleSchema = BaseDecorSchema.extend({
  type: z.literal("circle"),
  radius: z.number(),
  center: PointSchema,
});
export const DecorCircleDefSchema = BaseDecorDefSchema.extend({
  type: z.literal("circle"),
  radius: z.number(),
  center: PointSchema,
});

export const DecorCuboidSchema = BaseDecorSchema.extend({
  type: z.literal("cuboid"),
  center: Vector3LikeSchema,
  transform: SixTupleSchema,
});
export const DecorCuboidDefSchema = BaseDecorDefSchema.extend(RectSchema.shape).extend({
  type: z.literal("cuboid"),
  baseY: z.number(),
  height3d: z.number(),
  transform: SixTupleSchema.optional(),
});

export const DecorPointSchema = BaseDecorSchema.extend({
  type: z.literal("point"),
  x: z.number(),
  y: z.number(),
  orient: z.number(),
  meta: MetaSchema.and(GmRoomIdSchema).and(z.object({ img: z.string().optional() })),
});
export const DecorPointDefSchema = BaseDecorDefSchema.extend({
  type: z.literal("point"),
  x: z.number(),
  y: z.number(),
  img: z.string().optional(),
  orient: z.number().optional(),
  y3d: z.number().optional(),
});

export const DecorQuadSchema = BaseDecorSchema.extend({
  type: z.literal("quad"),
  transform: SixTupleSchema,
  center: PointSchema,
  det: z.number(),
  meta: MetaSchema.and(GmRoomIdSchema).and(z.object({ img: z.string() })),
});
export const DecorQuadDefSchema = BaseDecorDefSchema.extend(RectSchema.shape).extend({
  type: z.literal("quad"),
  img: z.string(),
  color: z.string().optional(),
  transform: SixTupleSchema.optional(),
  y3d: z.number().optional(),
});

export const DecorDecalSchema = BaseDecorSchema.extend({
  type: z.literal("decal"),
  transform: SixTupleSchema,
  center: PointSchema,
  det: z.number(),
  meta: MetaSchema.and(GmRoomIdSchema).and(z.object({ img: z.string() })),
});

export const DecorRectSchema = BaseDecorSchema.extend({
  type: z.literal("rect"),
  points: z.array(PointSchema),
  center: PointSchema,
  angle: z.number(),
});
export const DecorRectDefSchema = BaseDecorDefSchema.extend(RectSchema.shape).extend({
  type: z.literal("rect"),
  angle: z.number().optional(),
});

export const DecorSchema = z.discriminatedUnion("type", [
  DecorCircleSchema,
  DecorCuboidSchema,
  DecorPointSchema,
  DecorQuadSchema,
  DecorDecalSchema,
  DecorRectSchema,
]);
export type Decor = z.infer<typeof DecorSchema>;

export const DecorDefSchema = z.discriminatedUnion("type", [
  DecorCircleDefSchema,
  DecorCuboidDefSchema,
  DecorPointDefSchema,
  DecorQuadDefSchema,
  DecorRectDefSchema,
]);
export type DecorDef = z.infer<typeof DecorDefSchema>;

export const TriangulationSchema = z.object({
  vs: z.array(PointSchema),
  tris: z.array(z.tuple([z.number(), z.number(), z.number()])),
});

//#endregion

//#region assets schemas

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
    srcType: "symbol" as const,
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
  return node !== null && (node.type === "symbol" || node.type === "image" || node.type === "path");
}

export function isNodeTransformable(node: MapNode | null): node is TransformableMapNode {
  return node !== null && node.type !== "group";
}

const namePreservesRegexes = ["wall", "door", "obstacle", "decor"].map((type) => new RegExp(`^${type}(\\s|$)`));

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

export function filterNodes<T extends MapNode = MapNode>(list: MapNode[], test: (el: MapNode) => el is T): T[] {
  const output = [] as T[];
  for (const item of list) {
    if (test(item)) output.push(item);
    if (item.type === "group") output.push(...filterNodes(item.children, test));
  }
  return output;
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
  const result = MapEditFileSpecifierSchema.safeParse({ type, filename, key: filename?.replace(/\.json$/, "") });
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
