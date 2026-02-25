import type { StarshipSymbolImageKey } from "@npc-cli/media/starship-symbol";
import { Mat, Rect as RectClass } from "@npc-cli/util";

/** Compute CSS transform string for an image node, preserving bounding box top-left on rotation */
export function recomputeImageCssTransform(node: Extract<MapNode, { type: "image" }>): string {
  const { baseRect, transform, offset } = node;
  const { width: W, height: H } = baseRect;
  const { x, y, scale: s, degrees } = transform;
  const [cx, cy] = [W / 2, H / 2];
  // Correction to preserve bounding box top-left after rotation around center
  const needsCorrection = degrees === 90 || degrees === 270;
  const dx = needsCorrection ? (s * (H - W)) / 2 : 0;
  const dy = needsCorrection ? (s * (W - H)) / 2 : 0;
  const tx = offset.x + x + dx;
  const ty = offset.y + y + dy;
  return (node.cssTransform = `translate(${tx}px, ${ty}px) scale(${s}) translate(${cx}px, ${cy}px) rotate(${degrees}deg) translate(${-cx}px, ${-cy}px)`);
}

export function mapElements(list: MapNode[], id: string, fn: (el: MapNode) => MapNode): MapNode[] {
  return list.map((item) => {
    if (item.id === id) return fn(item);
    if (item.type === "group") return { ...item, children: mapElements(item.children, id, fn) };
    return item;
  });
}

export function traverseElements(list: MapNode[], act: (el: MapNode) => void): void {
  list.forEach((item) => {
    act(item);
    if (item.type === "group") traverseElements(item.children, act);
  });
}

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

/** Returns index of child before it was removed */
export function removeNodeFromParent(parentArray: MapNode[], childId: string) {
  const index = parentArray.findIndex((n) => n.id === childId);
  if (index === -1) throw Error(`Expected id ${childId} in ${JSON.stringify(parentArray)}`);
  parentArray.splice(index, 1);
  return index;
}

const defaultBaseRect: BaseRect = { width: 60, height: 60 };
const defaultTransform: Transform = { x: 0, y: 0, scale: 1, degrees: 0 };

const mockBaseNode: BaseMapNode = {
  id: "mock-id",
  name: "New Node",
  locked: false,
  visible: true,
  transform: { ...defaultTransform },
};

export const templateNodeByKey = {
  group: { ...mockBaseNode, type: "group", children: [] as MapNode[] },
  path: { ...mockBaseNode, type: "path" },
  image: {
    ...mockBaseNode,
    type: "image",
    imageKey: "unset" as Extract<MapNode, { type: "image" }>["imageKey"],
    baseRect: { ...defaultBaseRect },
    offset: { x: 0, y: 0 },
    cssTransform:
      "translate(0px, 0px) scale(1) translate(30px, 30px) rotate(0deg) translate(-30px, -30px)",
  },
  rect: {
    ...mockBaseNode,
    type: "rect",
    baseRect: { ...defaultBaseRect },
  },
} satisfies Record<MapNodeType, MapNode>;

export type MapNodeType = "group" | "image" | "path" | "rect";

export type BaseMapNode = {
  id: string;
  name: string;
  locked: boolean;
  visible: boolean;
  transform: Transform;
};

export type MapNode = BaseMapNode &
  (
    | { type: "group"; children: MapNode[] }
    | {
        type: "image";
        imageKey: StarshipSymbolImageKey | "unset";
        baseRect: BaseRect;
        transform: Transform;
        /** Align source PNG to grid */
        offset: Geom.VectJson;
        /** Precomputed CSS transform string */
        cssTransform: string;
      }
    | { type: "rect"; baseRect: BaseRect; transform: Transform }
    | { type: Exclude<MapNodeType, "group" | "rect" | "image"> }
  );

export type MapRectNode = Extract<MapNode, { type: "rect" }>;

export type BaseRect = { width: number; height: number };
export type Transform = {
  x: number;
  y: number;
  scale: number;
  /** Rotation in degrees (0, 90, 180, 270) */
  degrees: number;
};

/** Compute the world-space bounds of a rect/image node */
export function getNodeBounds(node: Extract<MapNode, { baseRect: BaseRect }>): Rect {
  if (node.type === "rect") {
    return {
      x: node.transform.x,
      y: node.transform.y,
      width: node.baseRect.width * node.transform.scale,
      height: node.baseRect.height * node.transform.scale,
    };
  } else {
    const { a, b, c, d, e, f } = new DOMMatrix(node.cssTransform);
    const m = new Mat([a, b, c, d, e, f]);
    const baseRect = new RectClass(0, 0, node.baseRect.width, node.baseRect.height);
    return baseRect.applyMatrix(m);
  }
}

type Rect = { x: number; y: number; width: number; height: number };

export type GroupMapNode = Pretty<Extract<MapNode, { type: "group" }>>;

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
