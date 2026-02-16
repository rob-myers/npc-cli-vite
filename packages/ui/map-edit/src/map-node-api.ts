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

export type ShapeType = "rect" | "circle" | "path" | "group" | "ellipse" | "polygon";

export type BaseMapNode = {
  id: string;
  name: string;
  isVisible: boolean;
  isLocked: boolean;
};

export type MapNode = BaseMapNode &
  (
    | { type: "group"; children: MapNode[] }
    | { type: "rect"; rect: Rect }
    | { type: Exclude<ShapeType, "group" | "rect"> }
  );

type Rect = { x: number; y: number; width: number; height: number };

export type GroupMapNode = Pretty<Extract<MapNode, { type: "group" }>>;
