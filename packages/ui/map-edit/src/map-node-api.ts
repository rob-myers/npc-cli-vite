import type { StarshipSymbolImageKey } from "@npc-cli/media/starship-symbol";

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
const defaultTransform: Transform = { x: 0, y: 0, dx: 0, dy: 0, scale: 1 };

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
  dx: number;
  dy: number;
};

/** Compute the world-space bounds of a rect/image node */
export function getNodeBounds(node: Extract<MapNode, { baseRect: BaseRect }>): Rect {
  const { baseRect, transform } = node;
  return {
    x: transform.x,
    y: transform.y,
    width: baseRect.width * transform.scale,
    height: baseRect.height * transform.scale,
  };
}

type Rect = { x: number; y: number; width: number; height: number };

export type GroupMapNode = Pretty<Extract<MapNode, { type: "group" }>>;

export type MapNodeByType<T extends MapNodeType> = Pretty<Extract<MapNode, { type: T }>>;

export type MapNodeMap = { [T in MapNodeType]: MapNodeByType<T> };

export const baseSvgSize = 600;
