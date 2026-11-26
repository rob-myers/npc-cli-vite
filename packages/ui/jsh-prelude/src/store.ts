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
  /** Each command's replacements by its id, applied as it runs, e.g. `{ rob: "sue" }`. A SkipNet fence sets them */
  subs?: Record<string, Record<string, string>>;
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
  /** Stops it running, a default by turning it off, forgetting its replacements */
  remove(worldKey: string, id: string) {
    const { entries, off = [] } = preludeApi.get(worldKey);
    const subs = subsWith(worldKey, id, {});
    defaultIds.has(id)
      ? preludeApi.patch(worldKey, { off: [...off.filter((x) => defaultIds.has(x)), id], subs })
      : preludeApi.patch(worldKey, { entries: entries.filter((x) => x.id !== id), subs });
  },
  setAutorun(worldKey: string, autorun: boolean) {
    preludeApi.patch(worldKey, { autorun });
  },
  /** Sets the command's replacements, or forgets them if none */
  setSubs(worldKey: string, id: string, subs: Record<string, string>) {
    preludeApi.patch(worldKey, { subs: subsWith(worldKey, id, subs) });
  },
  /** Removes it if it runs, else adds it, a default by no longer turning it off. Its replacements go with it */
  toggle(worldKey: string, entry: PreludeEntry, subs: Record<string, string> = {}) {
    if (preludeApi.entries(worldKey).some((x) => x.id === entry.id)) {
      return preludeApi.remove(worldKey, entry.id);
    }
    const { entries, off = [] } = preludeApi.get(worldKey);
    const withSubs = subsWith(worldKey, entry.id, subs);
    defaultIds.has(entry.id)
      ? preludeApi.patch(worldKey, { off: off.filter((x) => x !== entry.id), subs: withSubs })
      : preludeApi.patch(worldKey, { entries: [...entries, entry], subs: withSubs });
  },
};

/** The World's replacements with `id`'s set to `subs`, or forgotten if none, so one patch saves both */
function subsWith(worldKey: string, id: string, subs: Record<string, string>) {
  const { [id]: _, ...rest } = preludeApi.get(worldKey).subs ?? {};
  return Object.keys(subs).length === 0 ? rest : { ...rest, [id]: subs };
}

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

/**
 * `text` with each whole word or key of `subs` replaced by its value, in one pass, e.g. `rob` but not `rob-2`.
 * A word is letters, digits, `_` and `-`, as an npc's key.
 */
export function substitute(text: string, subs: undefined | Record<string, string>) {
  const pattern = subsPattern(subs);
  return pattern === null ? text : text.replace(pattern, (k) => subs?.[k] ?? k);
}

/** Matches the whole words `substitute` replaces, those `subs` changes, else `null`. Built once per `subs` */
export function subsPattern(subs: undefined | Record<string, string>) {
  if (subs === undefined) return null;
  let pattern = patternBySubs.get(subs);
  if (pattern === undefined) {
    const keys = Object.keys(subs).filter((k) => subs[k] !== k);
    const alternatives = keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    pattern = keys.length === 0 ? null : new RegExp(`(?<![\\w-])(?:${alternatives})(?![\\w-])`, "g");
    patternBySubs.set(subs, pattern);
  }
  return pattern;
}

const patternBySubs = new WeakMap<Record<string, string>, null | RegExp>();
