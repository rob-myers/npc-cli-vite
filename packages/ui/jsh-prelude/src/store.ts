import { useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { defaultEntries, defaultIds } from "./defaults";

/** A command to run in a tty before its World first plays */
export type PreludeEntry = {
  /** The SkipNet example it came from, e.g. `npc-controls#abc/0` */
  id: string;
  articleKey: string;
  /** Unset, e.g. for a default, it runs in its World's first tty */
  sessionKey?: `tty-${number}`;
  /** A copy, so it still runs after its article changes */
  src: string;
  /** Its comment lines, joined */
  comment: string;
};

/** A World's prelude. Read from `usePrelude` or `preludeApi.entries`, its `entries` include the defaults */
export type WorldPrelude = {
  /** Does the World run its prelude on load? */
  autorun: boolean;
  /** Those toggled on, in that order */
  entries: PreludeEntry[];
  /** The defaults toggled off */
  off?: string[];
};

type PreludeState = { byWorld: Record<string, WorldPrelude> };

export const preludeStore = create<PreludeState>()(
  persist((): PreludeState => ({ byWorld: {} }), {
    name: "jsh-prelude",
    storage: createJSONStorage(() => localStorage),
  }),
);

export const preludeApi = {
  /** What runs: the defaults not toggled off, then those toggled on */
  entries(worldKey: string): PreludeEntry[] {
    return withDefaults(preludeApi.get(worldKey));
  },
  /** As saved, without the defaults */
  get(worldKey: string): WorldPrelude {
    return preludeStore.getState().byWorld[worldKey] ?? emptyPrelude;
  },
  patch(worldKey: string, part: Partial<WorldPrelude>) {
    preludeStore.setState(({ byWorld }) => ({
      byWorld: { ...byWorld, [worldKey]: { ...preludeApi.get(worldKey), ...part } },
    }));
  },
  /** Stops it running, a default by turning it off */
  remove(worldKey: string, id: string) {
    const { entries, off = [] } = preludeApi.get(worldKey);
    defaultIds.has(id)
      ? preludeApi.patch(worldKey, { off: [...off.filter((x) => defaultIds.has(x)), id] })
      : preludeApi.patch(worldKey, { entries: entries.filter((x) => x.id !== id) });
  },
  setAutorun(worldKey: string, autorun: boolean) {
    preludeApi.patch(worldKey, { autorun });
  },
  /** Removes it if it runs, else adds it, a default by no longer turning it off */
  toggle(worldKey: string, entry: PreludeEntry) {
    if (preludeApi.entries(worldKey).some((x) => x.id === entry.id)) {
      return preludeApi.remove(worldKey, entry.id);
    }
    const { entries, off = [] } = preludeApi.get(worldKey);
    defaultIds.has(entry.id)
      ? preludeApi.patch(worldKey, { off: off.filter((x) => x !== entry.id) })
      : preludeApi.patch(worldKey, { entries: [...entries, entry] });
  },
};

/** The World's prelude as it changes, its `entries` those `preludeApi.entries` gives */
export function usePrelude(worldKey: string): WorldPrelude {
  const saved = preludeStore((s) => s.byWorld[worldKey] ?? emptyPrelude);
  return useMemo(() => ({ ...saved, entries: withDefaults(saved) }), [saved]);
}

/** The defaults not turned off, then those toggled on. A default once toggled on by hand stays a default */
function withDefaults({ entries, off = [] }: WorldPrelude): PreludeEntry[] {
  const skip = new Set(off);
  return [...defaultEntries.filter((x) => !skip.has(x.id)), ...entries.filter((x) => !defaultIds.has(x.id))];
}

const emptyPrelude: WorldPrelude = { autorun: true, entries: [] };
