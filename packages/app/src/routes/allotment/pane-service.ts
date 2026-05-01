import { uiStore } from "@npc-cli/ui-sdk/ui.store";

export type PaneNode =
  | { type: "leaf"; id: number }
  | { type: "split"; id: number; vertical: boolean; children: PaneNode[]; sizes?: number[]; hiddenIds?: number[] };

let nextId = 1;

export function initNextId(node: PaneNode) {
  if (node.id >= nextId) nextId = node.id + 1;
  if (node.type === "split") node.children.forEach(initNextId);
}

function createLeaf(): PaneNode {
  return { type: "leaf", id: nextId++ };
}

function setRoot(fn: (prev: PaneNode) => PaneNode) {
  uiStore.setState((draft) => {
    draft.persistedPanes = fn(draft.persistedPanes);
  });
}

export function splitPane(targetId: number, vertical: boolean) {
  setRoot((prev) => transformNode(prev, targetId, (node) => ({
    type: "split",
    id: nextId++,
    vertical,
    children: [node, createLeaf()],
  })));
}

export function closePane(targetId: number) {
  setRoot((prev) => {
    const result = removeNode(prev, targetId);
    return result ?? createLeaf();
  });
}

export function setSizes(splitId: number, sizes: number[]) {
  setRoot((prev) => transformNode(prev, splitId, (node) =>
    node.type === "split" ? { ...node, sizes } : node,
  ));
}

export function setPaneHidden(splitId: number, childIndex: number, visible: boolean) {
  setRoot((prev) => transformNode(prev, splitId, (node) => {
    if (node.type !== "split") return node;
    const childId = node.children[childIndex]?.id;
    if (childId === undefined) return node;
    const hiddenIds = new Set(node.hiddenIds);
    if (visible) hiddenIds.delete(childId);
    else hiddenIds.add(childId);
    return { ...node, hiddenIds: hiddenIds.size > 0 ? [...hiddenIds] : undefined };
  }));
}

export function showPane(splitId: number, childId: number) {
  setRoot((prev) => transformNode(prev, splitId, (node) => {
    if (node.type !== "split") return node;
    const hiddenIds = node.hiddenIds?.filter((id) => id !== childId);
    return { ...node, hiddenIds: hiddenIds?.length ? hiddenIds : undefined };
  }));
}

export function transformNode(node: PaneNode, targetId: number, fn: (node: PaneNode) => PaneNode): PaneNode {
  if (node.id === targetId) return fn(node);
  if (node.type === "split") {
    return { ...node, children: node.children.map((c) => transformNode(c, targetId, fn)) };
  }
  return node;
}

export function removeNode(node: PaneNode, targetId: number): PaneNode | null {
  if (node.id === targetId) return null;
  if (node.type === "split") {
    const remaining = node.children
      .map((c) => removeNode(c, targetId))
      .filter((c): c is PaneNode => c !== null);
    if (remaining.length === 0) return null;
    if (remaining.length === 1) return remaining[0];
    return { ...node, children: remaining };
  }
  return node;
}
