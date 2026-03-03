import { StarShipSymbolImageKeySchema } from "@npc-cli/media/starship-symbol";
import { Mat, Rect } from "@npc-cli/util/geom";
import { keys, tryLocalStorageGetParsed } from "@npc-cli/util/legacy/generic";
import z from "zod";

/** Find node and its parent */
export function findNode(
  /** Either top-level nodes or `group.childrem` */
  parentArray: MapNode[],
  id: string,
  parent: GroupMapNode | null = null,
): { node: MapNode; parent: null | GroupMapNode } | null {
  for (const child of parentArray) {
    if (child.id === id) {
      return { node: child, parent };
    }
    if (child.type === "group") {
      const result = findNode(child.children, id, child);
      if (result) return result;
    }
  }
  return null;
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

export function getAllNodeIds(nodes: MapNode[]) {
  const ids = new Set<string>();
  traverseNodesSync(nodes, (node) => void ids.add(node.id));
  return ids;
}

/** Compute the world-space bounds of a rect/image node */
export function getNodeBounds(node: Extract<MapNode, { baseRect: BaseRect }>): Geom.RectJson {
  if (node.type === "rect") {
    return {
      x: node.transform.e,
      y: node.transform.f,
      // (a,0,0,d,e,f) since rotation not allowed
      width: node.baseRect.width * node.transform.a,
      height: node.baseRect.height * node.transform.d,
    };
  } else {
    const { a, b, c, d, e, f } = new DOMMatrix(node.cssTransform);
    const m = new Mat([a, b, c, d, e, f]);
    const baseRect = new Rect(0, 0, node.baseRect.width, node.baseRect.height);
    return baseRect.applyMatrix(m);
  }
}

export function insertNodeAt(
  srcNode: MapNode,
  dstArray: MapNode[],
  dstChildId: string,
  edge: "top" | "bottom",
): void {
  const index = dstArray.findIndex((n) => n.id === dstChildId);
  if (index === -1) throw Error(`Expected id ${dstChildId} in ${JSON.stringify(dstArray)}`);
  const idx = edge === "top" ? index : index + 1;
  dstArray.splice(idx, 0, srcNode);
}

export function mapNodes(list: MapNode[], id: string, fn: (el: MapNode) => MapNode): MapNode[] {
  return list.map((item) => {
    if (item.id === id) return fn(item);
    if (item.type === "group") return { ...item, children: mapNodes(item.children, id, fn) };
    return item;
  });
}

export function computeNodeCssTransform(node: MapNode): string {
  if (node.type === "rect") {
    return computeRectCssTransform(node);
  } else if (node.type === "image") {
    return computeImageCssTransform(node);
  } else {
    return ""; // NOOP
  }
}

/**
 * Compute CSS transform string for an image node.
 */
function computeImageCssTransform(node: Extract<MapNode, { type: "image" }>): string {
  const { transform, offset } = node;
  return `matrix(${transform.a}, ${transform.b}, ${transform.c}, ${transform.d}, ${transform.e + offset.x}, ${transform.f + offset.y})`;
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
    imageKey: "unset" as Extract<MapNode, { type: "image" }>["imageKey"],
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
    symbolKey: "unset",
    baseRect: defaultBaseRect,
    offset: defaultPoint,
    cssTransform: "matrix(1, 0, 0, 1, 0, 0)",
  },
} satisfies Record<MapNodeType, MapNode>;

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
    type: z.literal("image"),
    imageKey: z.union([z.literal("unset"), StarShipSymbolImageKeySchema]),
    baseRect: z.object({ width: z.number(), height: z.number() }),
    offset: z.object({ x: z.number(), y: z.number() }),
    cssTransform: z.string(),
  }),
  BaseNodeSchema.extend({
    type: z.literal("rect"),
    baseRect: z.object({ width: z.number(), height: z.number() }),
    cssTransform: z.string(),
  }),
  BaseNodeSchema.extend({
    type: z.literal("symbol"),
    // 🚧 enforce StarShipSymbolImageKeySchema; currently permit foo.json
    symbolKey: z.string(),
    baseRect: z.object({ width: z.number(), height: z.number() }),
    offset: z.object({ x: z.number(), y: z.number() }),
    cssTransform: z.string(),
  }),
]);

export type MapNode = z.infer<typeof MapNodeSchema>;
export type MapNodeType = MapNode["type"];
export type RectMapNode = Pretty<Extract<MapNode, { type: "rect" }>>;
export type GroupMapNode = Pretty<Extract<MapNode, { type: "group" }>>;

export const mapNodeTypes = keys({
  group: true,
  image: true,
  rect: true,
  symbol: true,
} satisfies Record<MapNodeType, true>);

export type BaseRect = { width: number; height: number };
export type Transform = z.infer<typeof TransformSchema>;

export type MapNodeByType<T extends MapNodeType> = Pretty<Extract<MapNode, { type: T }>>;
export type MapNodeMap = { [T in MapNodeType]: MapNodeByType<T> };

export const baseSvgSize = 600;

export const labelledImageOffsetValue = {
  zero: 0,
  halfLineWidth: -0.7,
  /**
   * East align `bed--004--0.8x1.4 1`
   * > `-22 / 5 + 0.7`
   */
  eastAlignBed004: -3.7,
  /**
   * e.g. `console--051--0.4x0.6 1`
   * > `((150 - 137) / 2) / 5`
   */
  centerXConsole051: 1.3,
} as const;

export const imageOffsetValues = Object.values(labelledImageOffsetValue)
  .flatMap((x) => (x === 0 ? 0 : [Math.abs(x), -Math.abs(x)]))
  .sort();

export const ALLOWED_MAP_EDIT_FOLDERS = ["symbol", "map"] as const;

export const MapEditSavedSymbolSchema = z.object({
  /** 🚧 enforce StarshipSymbolImageKey?  */
  type: z.literal("symbol"),
  filename: z.string(),
  width: z.number(),
  height: z.number(),
  nodes: z.array(MapNodeSchema),
});
export const MapEditSavedMapSchema = z.object({
  type: z.literal("map"),
  filename: z.string(),
  width: z.number(),
  height: z.number(),
  nodes: z.array(MapNodeSchema),
});
export const MapEditSavedFileSchema = z.union([MapEditSavedSymbolSchema, MapEditSavedMapSchema]);

export type MapEditSavedSymbol = z.infer<typeof MapEditSavedSymbolSchema>;
export type MapEditSavedMap = z.infer<typeof MapEditSavedMapSchema>;
export type MapEditSavedFile = z.infer<typeof MapEditSavedFileSchema>;
export type MapEditSavableFileType = MapEditSavedFile["type"];

export function isSavableFileType(type: string): type is MapEditSavableFileType {
  return ALLOWED_MAP_EDIT_FOLDERS.includes(type as MapEditSavableFileType);
}

export type MapEditFileSpecifier = { type: MapEditSavableFileType; filename: string };

export function getFileSpecifierLocalStorageKey(file: MapEditFileSpecifier) {
  return `${LOCAL_STORAGE_PREFIX}${file.type}:${file.filename}`;
}

export function decodeFileSpecifierLocalStorageKey(localStorageKey: string) {
  const [, type, filename] = localStorageKey.split(/[:]/);
  return { type: type as MapEditSavableFileType, filename };
}

export function areFileSpecifiersEqual(a: MapEditFileSpecifier, b: MapEditFileSpecifier): boolean {
  return a.type === b.type && a.filename === b.filename;
}

export type UiIdToCurrentFileSpecifer = Record<string, MapEditFileSpecifier>;

export function extendCurrentFileSpecifierMapping(
  uiId: string,
  fileSpecifier: MapEditFileSpecifier,
): UiIdToCurrentFileSpecifer {
  return {
    ...tryLocalStorageGetParsed<UiIdToCurrentFileSpecifer>(LOCAL_STORAGE_UI_ID_TO_FILE_SPECIFIER),
    [uiId]: fileSpecifier,
  };
}

export const LOCAL_STORAGE_PREFIX = "map-edit:";
export const LOCAL_STORAGE_UI_ID_TO_FILE_SPECIFIER = "map-edit-to-current-file";

//#region dev api

export type MapEditListFilesResponse = {
  files: MapEditFileSpecifier[];
};

export type MapEditListFoldersResponse = {
  folders: readonly string[];
};

//#endregion

export const SymbolsMetadataSchema = z.object({
  createdAt: z.string(),
  byFilename: z.record(
    z.string(), // 🚧 refine
    z.object({
      filename: z.string(), // 🚧 refine
      thumbnailFilename: z.string(),
      width: z.number(),
      height: z.number(),
    }),
  ),
});

export type SymbolsMetadata = z.infer<typeof SymbolsMetadataSchema>;
