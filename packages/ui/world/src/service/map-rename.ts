import { isPlaygroundMapKey } from "@npc-cli/ui__map-edit/editor.schema";
import { defaultMapKey, emptyMapKey } from "../const.env";
import { isGraphEntry } from "../scenario.schema";

/** Neither named in code nor a playground, whose drafts are saved by key */
export function isRenamableMap(mapKey: string) {
  return mapKey !== defaultMapKey && mapKey !== emptyMapKey && !isPlaygroundMapKey(mapKey);
}

/** Why map `from` can't be renamed `to`, else `null` */
export function mapRenameError(maps: Partial<Record<string, unknown>>, from: string, to: string): null | string {
  if (maps[from] === undefined) return `no such map: ${from}`;
  if (!isRenamableMap(from)) return `${from} keeps its key`;
  if (isPlaygroundMapKey(to)) return "only a playground map's key ends -playground";
  if (!mapKeyRegex.test(to)) return "a key is a-z, 0-9, +, _ or -";
  if (maps[to] !== undefined) return `${to} already exists`;
  return null;
}

/** DEV only. Saves map `from`'s file as `to`, which the dev server adds to the assets index */
export async function saveMapFileAs(from: string, to: string) {
  const { request } = await import("./scenario-shared");
  const file = await request("GET", mapFileUrl(from));
  await request("POST", mapFileUrl(to), { ...file, key: to, filename: `${to}.json` });
}

/** DEV only. Points map `from`'s graphs at `to`, then deletes map `from`'s file */
export async function retireMapFile(from: string, to: string) {
  const { loadScenarioEntries, request, saveScenarioEntry } = await import("./scenario-shared");
  for (const entry of Object.values(await loadScenarioEntries())) {
    if (isGraphEntry(entry) && entry.mapKey === from) await saveScenarioEntry({ ...entry, mapKey: to });
  }
  await request("DELETE", mapFileUrl(from));
}

const mapKeyRegex = /^[a-z0-9+_-]+$/;

const mapFileUrl = (mapKey: string) => `/api/map-edit/file/map/${encodeURIComponent(`${mapKey}.json`)}`;
