import type { WorldState } from "@npc-cli/ui__world";
import type { GraphEntry } from "@npc-cli/ui__world/scenario.schema";

/**
 * Undo and redo over the map's runtime decor and its graphs, in one timeline. A snapshot is taken BEFORE
 * each of the panel's edits, so an undo restores things to how they were then — including anything
 * the shell or a card changed in between, which the panel does not track
 */
export class DecorHistory {
  past: Snapshot[] = [];
  future: Snapshot[] = [];
  w: WorldState;
  graphs: GraphStore;

  constructor(w: WorldState, graphs: GraphStore) {
    this.w = w;
    this.graphs = graphs;
  }

  /** The last edit's `merge`, and when */
  last: { merge: string; at: number } | null = null;

  /** Call before a decor edit. One with the `merge` of the last, soon after it, joins it: one undo takes back both */
  mark(merge?: string) {
    const now = performance.now();
    const joins = merge !== undefined && this.last?.merge === merge && now - this.last.at < mergeWithinMs;
    this.last = merge === undefined ? null : { merge, at: now };
    if (joins) return;
    this.push({ decor: this.decorNow() });
  }

  /** Call before graph `key` is saved or removed */
  markGraph(key: string) {
    this.last = null;
    this.push({ graphKey: key, graph: this.graphs.get(key) });
  }

  undo() {
    return this.step(this.past, this.future);
  }

  redo() {
    return this.step(this.future, this.past);
  }

  /** From `from` to `to`: `to` gets what is there now */
  private step(from: Snapshot[], to: Snapshot[]) {
    this.last = null;
    const snapshot = from.pop();
    if (snapshot === undefined) return false;
    to.push(
      "decor" in snapshot ? { decor: this.decorNow() } : { ...snapshot, graph: this.graphs.get(snapshot.graphKey) },
    );
    if ("decor" in snapshot) this.applyDecor(snapshot.decor);
    else this.graphs.set(snapshot.graphKey, snapshot.graph);
    return true;
  }

  private push(snapshot: Snapshot) {
    this.past.push(snapshot);
    if (this.past.length > maxHistory) this.past.shift();
    this.future = [];
  }

  private decorNow(): DecorDefs {
    return structuredClone(this.w.decor.runtime.defByKey);
  }

  /** Only what differs is touched: a decor untouched by the edit is left in peace */
  private applyDecor(defs: DecorDefs) {
    const { w } = this;
    const current = w.decor.runtime.defByKey;
    w.decor.remove(...Object.keys(current).filter((key) => !(key in defs)));
    for (const [key, def] of Object.entries(defs)) {
      if (JSON.stringify(current[key]) !== JSON.stringify(def)) w.decor.create(structuredClone(def));
    }
    w.view.forceUpdate();
  }
}

/** A field's steps on the same decor join one undo; typed edits do not merge */
export function mergeKey(stepped: boolean, keys: string[], field: string) {
  return stepped ? `${keys.join(",")}:${field}` : undefined;
}

/** The graphs as the panel has them: `null` is none by that key, so setting it removes one */
export type GraphStore = {
  get(key: string): null | GraphEntry;
  set(key: string, graph: null | GraphEntry): void;
};

type DecorDefs = Record<string, Geomorph.DecorDef>;
/** All the decor, else one graph */
type Snapshot = { decor: DecorDefs } | { graphKey: string; graph: null | GraphEntry };

const maxHistory = 100;
/** A merging edit this soon after the last of its kind joins it */
const mergeWithinMs = 1500;
