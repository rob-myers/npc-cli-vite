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

const mockBaseNode = {
  id: "mock-id",
  name: "New Node",
  isVisible: true,
  isLocked: false,
};

export const toTemplateNode = {
  group: { ...mockBaseNode, type: "group", children: [] as MapNode[] },
  path: { ...mockBaseNode, type: "path" },
  rect: { ...mockBaseNode, type: "rect", rect: { x: 50, y: 50, width: 100, height: 100 } },
} satisfies Record<MapNodeType, MapNode>;

export type MapNodeType = "rect" | "path" | "group";

export type BaseMapNode = {
  id: string;
  name: string;
  isVisible: boolean;
  isLocked: boolean;
};

export type MapNode = BaseMapNode &
  (
    | { type: "group"; children: MapNode[]; transform?: string }
    | { type: "rect"; rect: Rect }
    | { type: Exclude<MapNodeType, "group" | "rect"> }
  );

type Rect = { x: number; y: number; width: number; height: number };

export type GroupMapNode = Pretty<Extract<MapNode, { type: "group" }>>;

export type MapNodeByType<T extends MapNodeType> = Pretty<Extract<MapNode, { type: T }>>;

export type MapNodeMap = { [T in MapNodeType]: MapNodeByType<T> };
