import type { WorldState } from "@npc-cli/ui__world";

/**
 * Undo and redo over the map's runtime decor, as snapshots of its defs. A snapshot is taken BEFORE
 * each of the panel's edits, so an undo restores the decor to how it was then — including anything
 * the shell or a card changed in between, which the panel does not track
 */
export class DecorHistory {
  past: Snapshot[] = [];
  future: Snapshot[] = [];
  w: WorldState;

  constructor(w: WorldState) {
    this.w = w;
  }

  /** Call before an edit */
  mark() {
    this.past.push(this.snapshot());
    if (this.past.length > maxHistory) this.past.shift();
    this.future = [];
  }

  undo() {
    const prev = this.past.pop();
    if (prev === undefined) return false;
    this.future.push(this.snapshot());
    this.apply(prev);
    return true;
  }

  redo() {
    const next = this.future.pop();
    if (next === undefined) return false;
    this.past.push(this.snapshot());
    this.apply(next);
    return true;
  }

  snapshot(): Snapshot {
    return structuredClone(this.w.decor.runtime.defByKey);
  }

  /** Only what differs is touched: a decor untouched by the edit is left in peace */
  apply(snapshot: Snapshot) {
    const { w } = this;
    const current = w.decor.runtime.defByKey;
    w.decor.remove(...Object.keys(current).filter((key) => !(key in snapshot)));
    for (const [key, def] of Object.entries(snapshot)) {
      if (JSON.stringify(current[key]) !== JSON.stringify(def)) w.decor.create(structuredClone(def));
    }
    w.view.forceUpdate();
  }
}

type Snapshot = Record<string, Geomorph.DecorDef>;

const maxHistory = 100;
