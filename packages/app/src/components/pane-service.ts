import type { UiInstanceMeta } from "@npc-cli/ui-sdk";
import { getDefaultPanes, uiStore, uiStoreApi } from "@npc-cli/ui-sdk/ui.store";
import { type PaneNode as GenericPaneNode, paneTree } from "@npc-cli/util";

export type { PanePosition } from "@npc-cli/util";

const { findNode, removeNode, swapChild, toggleParentOrientation, transformNode } = paneTree;
export const { countPanes, findPanePosition } = paneTree;

export type PaneNode = GenericPaneNode<{ uiId?: string }>;

let nextId = 1;

export function initNextId(node: PaneNode) {
  if (node.id >= nextId) nextId = node.id + 1;
  if (node.type === "split") node.children.forEach(initNextId);
}

function createTabsUi(): string {
  const uiId = `ui-${crypto.randomUUID()}`;
  const title = uiStoreApi.getDefaultTitle("Tabs");
  uiStoreApi.addUis({
    metas: [{ id: uiId, title, uiKey: "Tabs", items: [], disabled: true }],
  });
  return uiId;
}

function setRoot(fn: (prev: PaneNode) => PaneNode) {
  uiStore.setState((draft) => {
    draft.persistedPanes.root = fn(draft.persistedPanes.root);
  });
}

export function splitRoot(vertical: boolean) {
  const { persistedPanes } = uiStore.getState();
  splitPane(persistedPanes.root.id, vertical);
}

export function splitPane(targetId: number, vertical: boolean) {
  const uiId = createTabsUi();
  const leafId = nextId++;
  setRoot((prev) =>
    transformNode(prev, targetId, (node) => ({
      type: "split",
      id: nextId++,
      vertical,
      children: [node, { type: "leaf", id: leafId, uiId }],
    })),
  );
  persistPanesToUi();
}

export function closePane(targetId: number) {
  const { persistedPanes } = uiStore.getState();
  const target = findNode(persistedPanes.root, targetId);
  if (target) {
    for (const uiId of collectLeafUiIds(target)) {
      uiStoreApi.removeItem(uiId);
    }
  }
  const newRoot = removeNode(persistedPanes.root, targetId);
  if (newRoot === null) {
    const fallbackUiId = createTabsUi();
    const fallbackId = nextId++;
    setRoot(() => ({ type: "leaf", id: fallbackId, uiId: fallbackUiId }));
  } else {
    setRoot(() => newRoot);
  }
  persistPanesToUi();
}

/** Set whilst `resetPanes` is under way, so the unload does not persist over its work */
let resetting = false;

/**
 * Back to the layout a first visit gets, discarding every ui — tabs and their contents alike.
 * By RELOADING: the fresh uis reuse keys such as `tty-0` and `world-0`, so starting them whilst
 * the old ones tear down races their sessions and stores. The store persists synchronously, so
 * the new layout is on disk before the page goes
 */
export function resetPanes() {
  resetting = true;
  uiStore.setState((draft) => {
    draft.persistedPanes = getDefaultPanes();
  });
  location.reload();
}

export function ensureLeafUis(node: PaneNode) {
  if (node.type === "leaf") {
    if (!node.uiId || !uiStoreApi.getUi(node.uiId)) {
      const uiId = `ui-${crypto.randomUUID()}`;
      const title = uiStoreApi.getDefaultTitle("Tabs");
      uiStoreApi.addUis({
        metas: [{ id: uiId, title, uiKey: "Tabs", items: [], disabled: true }],
      });
      setRoot((prev) => transformNode(prev, node.id, (n) => ({ ...n, uiId })));
    }
  } else {
    node.children.forEach(ensureLeafUis);
  }
}

/** Every tab into one Tabs, the focused one. Their uis only move, so none remounts. There is no undo */
export function flattenPanes() {
  const { persistedPanes, byId } = uiStore.getState();
  const tabsIds = collectLeafUiIds(persistedPanes.root).filter((id) => byId[id] !== undefined);
  if (tabsIds.length < 2) return;
  const focused = persistedPanes.focusedTabsUiId;
  const keepId = focused !== undefined && tabsIds.includes(focused) ? focused : tabsIds[0];
  const items = tabsIds.flatMap((id) => byId[id].meta.items ?? []);
  const leafId = nextId++;

  // one update, so no tab is ever shown by two Tabs at once
  uiStore.setState((draft) => {
    for (const id of tabsIds) if (id !== keepId) delete draft.byId[id]; // not `removeItem`, which takes their tabs
    draft.byId[keepId].meta.items = items;
    for (const id of items) {
      const ui = draft.byId[id];
      if (ui) ui.meta.parentId = keepId;
    }
    draft.persistedPanes.root = { type: "leaf", id: leafId, uiId: keepId };
  });
  persistPanesToUi();
}

export function findLeafByUiId(node: PaneNode, uiId: string): Extract<PaneNode, { type: "leaf" }> | null {
  if (node.type === "leaf") return node.uiId === uiId ? node : null;
  for (const child of node.children) {
    const found = findLeafByUiId(child, uiId);
    if (found) return found;
  }
  return null;
}

/** Unhides each pane between the root and the leaf holding `uiId` */
export function revealLeafOf(uiId: string) {
  const path = pathToLeaf(uiStore.getState().persistedPanes.root, uiId) ?? [];
  path.forEach((node, i) => {
    const child = path[i + 1];
    if (node.type === "split" && child && node.hiddenIds?.includes(child.id)) showPane(node.id, child.id);
  });
}

function pathToLeaf(node: PaneNode, uiId: string): PaneNode[] | null {
  if (node.type === "leaf") return node.uiId === uiId ? [node] : null;
  for (const child of node.children) {
    const rest = pathToLeaf(child, uiId);
    if (rest) return [node, ...rest];
  }
  return null;
}

function collectLeafUiIds(node: PaneNode): string[] {
  return paneTree.leaves(node).flatMap((leaf) => (leaf.uiId ? [leaf.uiId] : []));
}

export function swapPane(targetId: number, direction: -1 | 1) {
  setRoot((prev) => swapChild(prev, targetId, direction));
  persistPanesToUi();
}

export function toggleOrientation(targetId: number) {
  setRoot((prev) => toggleParentOrientation(prev, targetId));
  persistPanesToUi();
}

export function setSizes(splitId: number, sizes: number[]) {
  setRoot((prev) => transformNode(prev, splitId, (node) => (node.type === "split" ? { ...node, sizes } : node)));
}

/**
 * A pane which starts collapsed should not mount its ui until expanded — see `everSeen`.
 * Startup only: collapsing a pane later must not unmount what it already has.
 */
export function deferHiddenPaneUis(node: PaneNode, hidden = false) {
  if (node.type === "leaf") {
    if (hidden === true && node.uiId) {
      uiStoreApi.markEverSeen(node.uiId, false);
    }
    return;
  }
  const hiddenIds = new Set(node.hiddenIds);
  node.children.forEach((child) => deferHiddenPaneUis(child, hidden || hiddenIds.has(child.id)));
}

/** Mount whatever `node` contains, now that it is on screen */
function markPaneUisSeen(node: PaneNode) {
  for (const uiId of collectLeafUiIds(node)) {
    uiStoreApi.markEverSeen(uiId);
  }
}

export function setPaneHidden(splitId: number, childIndex: number, visible: boolean) {
  setRoot((prev) =>
    transformNode(prev, splitId, (node) => {
      if (node.type !== "split") return node;
      const childId = node.children[childIndex]?.id;
      if (childId === undefined) return node;
      const hiddenIds = new Set(node.hiddenIds);
      if (visible) hiddenIds.delete(childId);
      else hiddenIds.add(childId);
      return { ...node, hiddenIds: hiddenIds.size > 0 ? [...hiddenIds] : undefined };
    }),
  );

  if (visible === true) {
    // dragged back open, having possibly never mounted
    const split = findNode(uiStore.getState().persistedPanes.root, splitId);
    const child = split?.type === "split" ? split.children[childIndex] : undefined;
    if (child) markPaneUisSeen(child);
  }
}

export function showPane(splitId: number, childId: number) {
  setRoot((prev) =>
    transformNode(prev, splitId, (node) => {
      if (node.type !== "split") return node;
      const hiddenIds = node.hiddenIds?.filter((id) => id !== childId);
      return { ...node, hiddenIds: hiddenIds?.length ? hiddenIds : undefined };
    }),
  );

  const child = findNode(uiStore.getState().persistedPanes.root, childId);
  if (child) markPaneUisSeen(child);
}

export function persistPanesToUi() {
  if (resetting === true) return; // else the unload would rebuild `toUi` from the uis being discarded
  uiStore.setState((draft) => {
    const toUi: Record<string, UiInstanceMeta> = {};
    function collect(node: PaneNode) {
      if (node.type === "leaf" && node.uiId) {
        const entry = draft.byId[node.uiId];
        if (entry) {
          toUi[node.uiId] = entry.meta;
          for (const subId of entry.meta.items ?? []) {
            const sub = draft.byId[subId];
            if (sub) toUi[subId] = sub.meta;
          }
        }
      } else if (node.type === "split") {
        node.children.forEach(collect);
      }
    }
    collect(draft.persistedPanes.root);
    draft.persistedPanes.toUi = toUi;
  });
}
