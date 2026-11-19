import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/** A command to run in a tty before its World first plays */
export type PreludeEntry = {
  /** The SkipNet example it came from, e.g. `npc-controls#abc/0` */
  id: string;
  articleKey: string;
  sessionKey: `tty-${number}`;
  /** A copy, so it still runs after its article changes */
  src: string;
  /** Its comment lines, joined */
  comment: string;
};

export type WorldPrelude = {
  /** Does the World's first unpause run `entries`? */
  autoBoot: boolean;
  /** In the order they were toggled on */
  entries: PreludeEntry[];
};

type PreludeState = { byWorld: Record<string, WorldPrelude> };

export const preludeStore = create<PreludeState>()(
  persist((): PreludeState => ({ byWorld: {} }), {
    name: "jsh-prelude",
    storage: createJSONStorage(() => localStorage),
  }),
);

export const preludeApi = {
  get(worldKey: string): WorldPrelude {
    return preludeStore.getState().byWorld[worldKey] ?? emptyPrelude;
  },
  patch(worldKey: string, part: Partial<WorldPrelude>) {
    preludeStore.setState(({ byWorld }) => ({
      byWorld: { ...byWorld, [worldKey]: { ...preludeApi.get(worldKey), ...part } },
    }));
  },
  remove(worldKey: string, id: string) {
    preludeApi.patch(worldKey, { entries: preludeApi.get(worldKey).entries.filter((x) => x.id !== id) });
  },
  setAutoBoot(worldKey: string, autoBoot: boolean) {
    preludeApi.patch(worldKey, { autoBoot });
  },
  /** Adds it, else removes the entry with its id */
  toggle(worldKey: string, entry: PreludeEntry) {
    const { entries } = preludeApi.get(worldKey);
    entries.some((x) => x.id === entry.id)
      ? preludeApi.remove(worldKey, entry.id)
      : preludeApi.patch(worldKey, { entries: [...entries, entry] });
  },
};

/** The World's prelude, as it changes */
export function usePrelude(worldKey: string): WorldPrelude {
  return preludeStore((s) => s.byWorld[worldKey] ?? emptyPrelude);
}

const emptyPrelude: WorldPrelude = { autoBoot: true, entries: [] };
