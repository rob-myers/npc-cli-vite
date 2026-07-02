import { tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";

export type LoadDraftsMode = "use-drafts" | "use-originals";

const defaultLoadDrafts: LoadDraftsMode = import.meta.env.PROD ? "use-drafts" : "use-originals";

export function getLoadDrafts(storageKey: string): LoadDraftsMode {
  return tryLocalStorageGetParsed<LoadDraftsMode>(storageKey) ?? defaultLoadDrafts;
}

export function persistLoadDrafts(storageKey: string, value: LoadDraftsMode): void {
  tryLocalStorageSet(storageKey, JSON.stringify(value));
}
