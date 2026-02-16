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

export function extractNode(
  nodes: MapNode[],
  id: string,
): { elements: MapNode[]; node: MapNode | null } {
  for (const child of nodes) {
    if (child.id === id) {
      return { elements: nodes.filter((n) => n.id !== id), node: child };
    }
    if (child.type === "group") {
      const r = extractNode(child.children, id);
      if (r.node) {
        const updated = nodes.map((n) => (n.id === child.id ? { ...n, children: r.elements } : n));
        return { elements: updated, node: r.node };
      }
    }
  }
  return { elements: nodes, node: null };
}

export function insertNode(
  nodes: MapNode[],
  node: MapNode,
  targetId: string,
  edge: "top" | "bottom",
): MapNode[] {
  for (const [i, child] of nodes.entries()) {
    if (child.id === targetId) {
      const idx = edge === "top" ? i : i + 1;
      return [...nodes.slice(0, idx), node, ...nodes.slice(idx)];
    }

    if (child.type === "group") {
      const result = insertNode(child.children, node, targetId, edge);
      if (result !== child.children) {
        return [...nodes.slice(0, i), { ...child, children: result }, ...nodes.slice(i + 1)];
      }
    }
  }
  return nodes;
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
