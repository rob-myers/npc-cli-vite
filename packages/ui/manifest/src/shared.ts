import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { loadLore } from "./library";
import { isLoreCharacter, type LoreCharacter, type LoreEntry, loreChangedEvent } from "./lore.schema";

/**
 * What a Manifest and another panel on the same World tell each other, e.g. the Decorator's map:
 * neither imports the other's components, and either may be absent
 */
export type ManifestShared = {
  /** The entry the Manifest shows, as edited — for the map to outline */
  entry: null | LoreEntry;
  /** The npc last chosen on the map, whose entry the Manifest then shows */
  npcKey: null | string;
  /** A world point the Manifest asks the map to centre on: a new object each time */
  locate: null | Geom.VectJson;
  /** An npc the Manifest gave a new key, or with no `to` removed: a new object each time */
  renamed: null | { from: string; to: undefined | string };
};

const none: ManifestShared = { entry: null, npcKey: null, locate: null, renamed: null };
const byWorld: Record<string, ManifestShared> = {};
const listeners = new Set<() => void>();

export const manifestShared = {
  get(worldKey: string): ManifestShared {
    return byWorld[worldKey] ?? none;
  },
  set(worldKey: string, patch: Partial<ManifestShared>) {
    byWorld[worldKey] = { ...manifestShared.get(worldKey), ...patch };
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

export function useManifestShared(worldKey: string): ManifestShared {
  return useSyncExternalStore(manifestShared.subscribe, () => manifestShared.get(worldKey));
}

/**
 * Every character with an npc, loaded from the lore itself so no Manifest need be open — `shown`,
 * the one a Manifest is editing, standing in for its saved self
 */
export function useManifestLoreCharacters(shown: null | LoreEntry): LoreCharacter[] {
  const [entries, setEntries] = useState<Record<string, LoreEntry>>({});

  useEffect(() => {
    let gone = false;
    const load = () =>
      void loadLore()
        .then((next) => gone === false && setEntries(next))
        .catch(() => {});
    load();
    import.meta.hot?.on(loreChangedEvent, load);
    return () => {
      gone = true;
      import.meta.hot?.off(loreChangedEvent, load);
    };
  }, []);

  // kept whilst neither changes: a caller may depend on its identity
  return useMemo(
    () => Object.values(shown === null ? entries : { ...entries, [shown.key]: shown }).filter(isLoreCharacter),
    [entries, shown],
  );
}
