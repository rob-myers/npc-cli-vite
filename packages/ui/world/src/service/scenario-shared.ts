import "./virtual-scenario.d";
import bundledEntries from "virtual:scenario";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import z from "zod";
import {
  isScenarioCharacter,
  type ScenarioCharacter,
  type ScenarioEntry,
  ScenarioEntrySchema,
  scenarioApiPath,
  scenarioChangedEvent,
} from "../scenario.schema";

/**
 * What a Scenario panel and another panel on the same World tell each other, e.g. the Decorator's map.
 * Neither imports the other, and either may be absent
 */
export type ScenarioShared = {
  /** The entry the Scenario panel shows, as edited, for the map to outline */
  entry: null | ScenarioEntry;
  /** The npc last chosen on the map, whose entry the Scenario panel then shows */
  npcKey: null | string;
  /** A world point the Scenario panel asks the map to centre on: a new object each time */
  locate: null | Geom.VectJson;
  /** An npc the Scenario panel gave a new key, or with no `to` removed: a new object each time */
  renamed: null | { from: string; to: undefined | string };
};

const none: ScenarioShared = { entry: null, npcKey: null, locate: null, renamed: null };
const byWorld: Record<string, ScenarioShared> = {};
const listeners = new Set<() => void>();

export const scenarioShared = {
  get(worldKey: string): ScenarioShared {
    return byWorld[worldKey] ?? none;
  },
  set(worldKey: string, patch: Partial<ScenarioShared>) {
    byWorld[worldKey] = { ...scenarioShared.get(worldKey), ...patch };
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};

export function useScenarioShared(worldKey: string): ScenarioShared {
  return useSyncExternalStore(scenarioShared.subscribe, () => scenarioShared.get(worldKey));
}

/**
 * Every character with an npc, loaded from the files so no Scenario panel need be open.
 * `shown`, the one being edited, stands in for its saved self
 */
export function useScenarioCharacters(shown: null | ScenarioEntry): ScenarioCharacter[] {
  const [entries, setEntries] = useState<Record<string, ScenarioEntry>>({});

  useEffect(() => {
    let gone = false;
    const load = () =>
      void loadScenarioEntries()
        .then((next) => gone === false && setEntries(next))
        .catch(() => {});
    load();
    import.meta.hot?.on(scenarioChangedEvent, load);
    return () => {
      gone = true;
      import.meta.hot?.off(scenarioChangedEvent, load);
    };
  }, []);

  // kept whilst neither changes: a caller may depend on its identity
  return useMemo(
    () => Object.values(shown === null ? entries : { ...entries, [shown.key]: shown }).filter(isScenarioCharacter),
    [entries, shown],
  );
}

const ScenarioEntriesSchema = z.record(z.string(), ScenarioEntrySchema);

/** Every entry by key. Fetched during development, so a new file need not trigger a full reload */
export async function loadScenarioEntries(): Promise<Record<string, ScenarioEntry>> {
  // parsed, so an entry written before a field existed gains its default
  return ScenarioEntriesSchema.parse(
    import.meta.env.DEV !== true ? bundledEntries : await request("GET", scenarioApiPath),
  );
}

/** DEV only */
export async function saveScenarioEntry(entry: ScenarioEntry) {
  await request("POST", `${scenarioApiPath}/file/${entry.key}`, entry);
}

/** DEV only */
export async function deleteScenarioEntry(key: string) {
  await request("DELETE", `${scenarioApiPath}/file/${key}`);
}

async function request(method: string, url: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  if (response.ok === false) throw Error(json.error ?? `${url}: responded ${response.status}`);
  return json;
}
