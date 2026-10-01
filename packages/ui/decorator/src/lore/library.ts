import "./virtual.d";
import bundledLore from "virtual:lore";
import { type LoreEntry, loreApiPath } from "./lore.schema";

/** Every entry by key. Fetched during development, so a new file need not trigger a full reload */
export async function loadLore(): Promise<Record<string, LoreEntry>> {
  if (import.meta.env.DEV !== true) return bundledLore;
  return await request("GET", loreApiPath);
}

/** DEV only */
export async function saveLoreEntry(entry: LoreEntry) {
  await request("POST", `${loreApiPath}/file/${entry.key}`, entry);
}

/** DEV only */
export async function deleteLoreEntry(key: string) {
  await request("DELETE", `${loreApiPath}/file/${key}`);
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
