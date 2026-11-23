import "./virtual-scenario.d";
import bundledEntries from "virtual:scenario";
import { useEffect, useMemo, useState } from "react";
import z from "zod";
import {
  type GraphEntry,
  isGraphEntry,
  type ScenarioEntry,
  ScenarioEntrySchema,
  scenarioApiPath,
  scenarioChangedEvent,
} from "../scenario.schema";

/** Every entry by key, loaded from the files so no Scenario panel need be open, and reloaded as they change */
export function useScenarioEntries(): Record<string, ScenarioEntry> {
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

  return entries;
}

/** The graphs on map `mapKey` by key, and every other map's */
export function useScenarioGraphs(mapKey: string): { here: Record<string, GraphEntry>; others: GraphEntry[] } {
  const entries = useScenarioEntries();
  return useMemo(() => {
    const graphs = Object.values(entries).filter(isGraphEntry);
    return {
      here: Object.fromEntries(graphs.filter((x) => x.mapKey === mapKey).map((x) => [x.key, x])),
      others: graphs.filter((x) => x.mapKey !== mapKey),
    };
  }, [entries, mapKey]);
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

/** A JSON request, throwing the server's error */
export async function request(method: string, url: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  if (response.ok === false) throw Error(json.error ?? `${url}: responded ${response.status}`);
  return json;
}
