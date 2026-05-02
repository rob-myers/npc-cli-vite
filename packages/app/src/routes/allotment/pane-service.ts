import { uiStore, uiStoreApi } from "@npc-cli/ui-sdk/ui.store";

export type PaneNode =
  | { type: "leaf"; id: number; uiId?: string }
  | { type: "split"; id: number; vertical: boolean; children: PaneNode[]; sizes?: number[]; hiddenIds?: number[] };

let nextId = 1;

export function initNextId(node: PaneNode) {
  if (node.id >= nextId) nextId = node.id + 1;
  if (node.type === "split") node.children.forEach(initNextId);
}

function createTabsUi(): string {
  const uiId = `ui-${crypto.randomUUID()}`;
  const title = uiStoreApi.getDefaultTitle("Tabs");
  uiStoreApi.addUis({
    metas: [{ id: uiId, title, uiKey: "Tabs", items: [], disabled: false }],
  });
  return uiId;
}

function setRoot(fn: (prev: PaneNode) => PaneNode) {
  uiStore.setState((draft) => {
    draft.persistedPanes = fn(draft.persistedPanes);
  });
}

export function splitPane(targetId: number, vertical: boolean) {
  const uiId = createTabsUi();
  const leafId = nextId++;
  setRoot((prev) => transformNode(prev, targetId, (node) => ({
    type: "split",
    id: nextId++,
    vertical,
    children: [node, { type: "leaf", id: leafId, uiId }],
  })));
}

export function closePane(targetId: number) {
  const { persistedPanes } = uiStore.getState();
  const leaf = findNode(persistedPanes, targetId);
  if (leaf?.type === "leaf" && leaf.uiId) {
    uiStoreApi.removeItem(leaf.uiId);
  }
  const fallbackUiId = createTabsUi();
  const fallbackId = nextId++;
  setRoot((prev) => {
    const result = removeNode(prev, targetId);
    return result ?? { type: "leaf", id: fallbackId, uiId: fallbackUiId };
  });
}

export function ensureLeafUis(node: PaneNode) {
  if (node.type === "leaf") {
    if (!node.uiId || !uiStoreApi.getUi(node.uiId)) {
      const uiId = `ui-${crypto.randomUUID()}`;
      const title = uiStoreApi.getDefaultTitle("Tabs");
      uiStoreApi.addUis({
        metas: [{ id: uiId, title, uiKey: "Tabs", items: [], disabled: false }],
      });
      setRoot((prev) => transformNode(prev, node.id, (n) => ({ ...n, uiId })));
    }
  } else {
    node.children.forEach(ensureLeafUis);
  }
}

function findNode(node: PaneNode, targetId: number): PaneNode | null {
  if (node.id === targetId) return node;
  if (node.type === "split") {
    for (const child of node.children) {
      const found = findNode(child, targetId);
      if (found) return found;
    }
  }
  return null;
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
    if (remaining.length === 1) {
      const promoted = remaining[0];
      if (promoted.type === "split") return { ...promoted, sizes: undefined };
      return promoted;
    }
    return { ...node, children: remaining };
  }
  return node;
}
