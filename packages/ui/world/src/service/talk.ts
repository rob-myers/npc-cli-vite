import type { ConversationChoice, ConversationEntry, ConversationNode } from "../scenario.schema";

/** Played in `WorldSpeech`, outlined in the Scenario panel — see `docs/scenarios.md` */
export type Conversation = ConversationEntry;
export type { ConversationChoice, ConversationNode };

export type OutlineRow = {
  key: string;
  nodeId: string;
  depth: number;
  via: null | string;
  /** What `via` needs */
  needs: string[];
  /** Unfolded elsewhere: a graph's node is drawn in full once, nearest the start */
  ref: boolean;
  /** No such node */
  missing: boolean;
  kids: number;
  /** Its topic, where that differs from its parent's */
  topic: null | string;
};

export type Outline = {
  rows: OutlineRow[];
  endings: number;
  /** Node ids no choice leads to */
  unreachable: string[];
  missing: number;
};

/** The graph as a tree in preorder, each node unfolded under the parent a breadth-first walk meets it by */
export function toOutline(c: Conversation): Outline {
  /** `{parent id}#{choice index}` of the edge each node is unfolded under */
  const homeEdge = new Map<string, string>([[c.start, ""]]);
  const queue = [c.start];
  for (let i = 0; i < queue.length; i++) {
    (c.nodes[queue[i]]?.choices ?? []).forEach(({ to }, j) => {
      if (homeEdge.has(to) || c.nodes[to] === undefined) return;
      homeEdge.set(to, `${queue[i]}#${j}`);
      queue.push(to);
    });
  }

  const rows: OutlineRow[] = [];
  const visit = (nodeId: string, parent: null | OutlineRow, edge: string, via: null | ConversationChoice) => {
    const node = c.nodes[nodeId] as ConversationNode | undefined;
    const ref = node !== undefined && homeEdge.get(nodeId) !== edge;
    const row: OutlineRow = {
      key: parent === null ? nodeId : `${parent.key}>${edge.split("#")[1]}:${nodeId}`,
      nodeId,
      depth: parent === null ? 0 : parent.depth + 1,
      via: via?.text ?? null,
      needs: via?.needs ?? [],
      ref,
      missing: node === undefined,
      kids: node === undefined || ref ? 0 : (node.choices?.length ?? 0),
      topic: node?.topic !== undefined && node.topic !== c.nodes[parent?.nodeId ?? ""]?.topic ? node.topic : null,
    };
    rows.push(row);
    if (row.kids > 0) node?.choices?.forEach((choice, j) => visit(choice.to, row, `${nodeId}#${j}`, choice));
  };
  visit(c.start, null, "", null);

  return {
    rows,
    endings: Object.values(c.nodes).filter((node) => (node.choices?.length ?? 0) === 0).length,
    unreachable: Object.keys(c.nodes).filter((nodeId) => homeEdge.has(nodeId) === false),
    missing: rows.filter((row) => row.missing).length,
  };
}

/** The rows under no folded ancestor */
export function visibleRows(rows: OutlineRow[], open: ReadonlySet<string>): OutlineRow[] {
  let foldedAt = Infinity;
  return rows.filter((row) => {
    if (row.depth > foldedAt) return false;
    foldedAt = open.has(row.key) ? Infinity : row.depth;
    return true;
  });
}

/** A thread of the speech history: whoever spoke in it, and to whom */
export function threadKeyOf(parties: string[]) {
  return [...new Set(parties)].sort().join(" + ");
}
