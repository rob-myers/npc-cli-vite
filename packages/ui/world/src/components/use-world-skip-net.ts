import { type UseStateRef, useStateRef } from "@npc-cli/util";
import type { State as WorldState } from "./World";

/** Items mounted from outside the World, e.g. by jsh, which a SkipNet pane shows */
export default function useWorldSkipNet(w: UseStateRef<WorldState>) {
  const state = useStateRef(
    (): State => ({
      items: [],
      listeners: new Set(),

      add(item) {
        // keyed, so a command re-run (or its hot-reload) replaces its item rather than doubling it
        state.items = [...state.items.filter((x) => x.key !== item.key), item];
        state.listeners.forEach((fn) => fn());
      },
      remove(key) {
        state.items = state.items.filter((x) => x.key !== key);
        state.listeners.forEach((fn) => fn());
      },
      subscribe(onChange) {
        state.listeners.add(onChange);
        return () => void state.listeners.delete(onChange);
      },
    }),
  );

  w.skipNet = state;
}

export type State = {
  /** Replaced on each change, so a snapshot of it is stable */
  items: JshCli.SkipNetItem[];
  listeners: Set<() => void>;
  /** Mounts an item, replacing any with its key */
  add(item: JshCli.SkipNetItem): void;
  remove(key: string): void;
  subscribe(onChange: () => void): () => void;
};
