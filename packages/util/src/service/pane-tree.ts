/** A tree of panes: leaves carry `L`, splits lay out their children one way */
export type PaneNode<L extends object = object> =
  | PaneLeaf<L>
  | { type: "split"; id: number; vertical: boolean; children: PaneNode<L>[]; sizes?: number[]; hiddenIds?: number[] };

export type PaneLeaf<L extends object = object> = { type: "leaf"; id: number } & L;

/** Where a pane goes beside another. `center` swaps them */
export type PaneEdge = "left" | "right" | "top" | "bottom" | "center";

export type PanePosition = { vertical: boolean; index: number; siblingCount: number };

export function countPanes<L extends object>(node: PaneNode<L>): number {
  return node.type === "leaf" ? 1 : node.children.reduce((sum, child) => sum + countPanes(child), 0);
}

export function findNode<L extends object>(node: PaneNode<L>, targetId: number): PaneNode<L> | null {
  if (node.id === targetId) return node;
  if (node.type === "split") {
    for (const child of node.children) {
      const found = findNode(child, targetId);
      if (found) return found;
    }
  }
  return null;
}

export function findPanePosition<L extends object>(node: PaneNode<L>, targetId: number): PanePosition | null {
  if (node.type !== "split") return null;
  const index = node.children.findIndex((c) => c.id === targetId);
  if (index !== -1) {
    return { vertical: node.vertical, index, siblingCount: node.children.length };
  }
  for (const child of node.children) {
    const found = findPanePosition(child, targetId);
    if (found) return found;
  }
  return null;
}

/** Every leaf, in order */
export function leaves<L extends object>(node: PaneNode<L>): PaneLeaf<L>[] {
  return node.type === "leaf" ? [node] : node.children.flatMap(leaves);
}

/** The largest id in the tree, so a new node takes the next */
export function maxPaneId<L extends object>(node: PaneNode<L>): number {
  return node.type === "leaf" ? node.id : Math.max(node.id, ...node.children.map(maxPaneId));
}

/** `sourceId` moved beside `targetId`, or swapped with it on `center` */
export function moveNode<L extends object>(
  root: PaneNode<L>,
  sourceId: number,
  targetId: number,
  edge: PaneEdge,
): PaneNode<L> {
  const source = findNode(root, sourceId);
  const target = findNode(root, targetId);
  if (source === null || target === null || sourceId === targetId) return root;
  if (edge === "center") {
    return mapNodes(root, (node) => (node.id === sourceId ? target : node.id === targetId ? source : node));
  }
  const removed = removeNode(root, sourceId);
  return removed === null ? root : splitNode(removed, targetId, source, edge);
}

/**
 * Without `targetId`, its sizes kept in step. A split left with one child becomes that child.
 * A child split lying the same way is merged in.
 */
export function removeNode<L extends object>(node: PaneNode<L>, targetId: number): PaneNode<L> | null {
  if (node.id === targetId) return null;
  if (node.type !== "split") return node;

  const kept = node.children.flatMap((c, i) => {
    const child = removeNode(c, targetId);
    return child === null ? [] : [{ child, size: node.sizes?.[i], hidden: node.hiddenIds?.includes(c.id) === true }];
  });
  if (kept.length === 0) return null;
  if (kept.length === 1) {
    const promoted = kept[0].child;
    return promoted.type === "split" ? { ...promoted, sizes: undefined } : promoted;
  }

  const children: PaneNode<L>[] = [];
  const sizes: (undefined | number)[] = [];
  /** Rebuilt, so a child replaced by its own child stays hidden as it */
  const hiddenIds = new Set<number>();
  for (const { child, size, hidden } of kept) {
    if (child.type === "split" && child.vertical === node.vertical) {
      // its size is shared among its children, as they were
      const total = child.sizes?.reduce((sum, x) => sum + x, 0) ?? 0;
      child.children.forEach((grandchild, j) => {
        children.push(grandchild);
        sizes.push(
          size !== undefined && child.sizes !== undefined && total > 0 ? (size * child.sizes[j]) / total : undefined,
        );
      });
      child.hiddenIds?.forEach((id) => hiddenIds.add(id));
      if (hidden) child.children.forEach((grandchild) => hiddenIds.add(grandchild.id));
    } else {
      children.push(child);
      sizes.push(size);
      if (hidden) hiddenIds.add(child.id);
    }
  }
  return {
    ...node,
    children,
    sizes: sizes.every((x) => x !== undefined) ? (sizes as number[]) : undefined,
    hiddenIds: hiddenIds.size > 0 ? [...hiddenIds] : undefined,
  };
}

/** `inserted` beside `targetId` on `edge`, joining its parent when that lies the same way */
export function splitNode<L extends object>(
  root: PaneNode<L>,
  targetId: number,
  inserted: PaneNode<L>,
  edge: Exclude<PaneEdge, "center">,
): PaneNode<L> {
  const vertical = edge === "top" || edge === "bottom";
  const before = edge === "left" || edge === "top";
  const splitId = Math.max(maxPaneId(root), maxPaneId(inserted)) + 1;

  const insert = (node: PaneNode<L>): PaneNode<L> => {
    if (node.id === targetId) {
      return { type: "split", id: splitId, vertical, children: before ? [inserted, node] : [node, inserted] };
    }
    if (node.type !== "split") return node;
    const index = node.children.findIndex((c) => c.id === targetId);
    if (index !== -1 && node.vertical === vertical) {
      const children = [...node.children];
      children.splice(before ? index : index + 1, 0, inserted);
      // the target's room is halved, its siblings' kept
      const sizes = node.sizes?.flatMap((x, i) => (i === index ? [x / 2, x / 2] : [x]));
      return { ...node, children, sizes };
    }
    return { ...node, children: node.children.map(insert) };
  };
  return insert(root);
}

/** `targetId` moved one place along its parent */
export function swapChild<L extends object>(node: PaneNode<L>, targetId: number, direction: -1 | 1): PaneNode<L> {
  if (node.type !== "split") return node;

  const index = node.children.findIndex((c) => c.id === targetId);
  if (index !== -1) {
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= node.children.length) return node;
    const children = [...node.children];
    [children[index], children[swapIndex]] = [children[swapIndex], children[index]];
    let sizes = node.sizes;
    if (sizes) {
      sizes = [...sizes];
      [sizes[index], sizes[swapIndex]] = [sizes[swapIndex], sizes[index]];
    }
    return { ...node, children, sizes };
  }

  return { ...node, children: node.children.map((c) => swapChild(c, targetId, direction)) };
}

/** Flips the way the parent of `targetId` lies */
export function toggleParentOrientation<L extends object>(node: PaneNode<L>, targetId: number): PaneNode<L> {
  if (node.type !== "split") return node;
  if (node.children.some((c) => c.id === targetId)) {
    return { ...node, vertical: !node.vertical };
  }
  return { ...node, children: node.children.map((c) => toggleParentOrientation(c, targetId)) };
}

export function transformNode<L extends object>(
  node: PaneNode<L>,
  targetId: number,
  fn: (node: PaneNode<L>) => PaneNode<L>,
): PaneNode<L> {
  if (node.id === targetId) return fn(node);
  if (node.type === "split") {
    return { ...node, children: node.children.map((c) => transformNode(c, targetId, fn)) };
  }
  return node;
}

/** Each node replaced by `fn`'s result. A replaced node's children are not visited */
function mapNodes<L extends object>(node: PaneNode<L>, fn: (node: PaneNode<L>) => PaneNode<L>): PaneNode<L> {
  const next = fn(node);
  if (next !== node || node.type !== "split") return next;
  return { ...node, children: node.children.map((c) => mapNodes(c, fn)) };
}
