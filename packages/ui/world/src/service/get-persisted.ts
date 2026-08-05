import { tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import { ambientIntensityKey, defaultAmbientIntensity, introEnabledKey, npcsStorageKeyPrefix } from "../const";

export const getAmbientIntensity = () =>
  tryLocalStorageGetParsed<number>(ambientIntensityKey) ?? defaultAmbientIntensity;

export const setAmbientIntensity = (next: number) => tryLocalStorageSet(ambientIntensityKey, String(next));

export const getIntroEnabled = () => tryLocalStorageGetParsed<boolean>(introEnabledKey) ?? true;

export const setIntroEnabled = (next: boolean) => tryLocalStorageSet(introEnabledKey, String(next));

const npcsKey = (mapKey: string) => `${npcsStorageKeyPrefix}:${mapKey}`;

export const getNpcs = (mapKey: string) => tryLocalStorageGetParsed<PersistedNpcs>(npcsKey(mapKey));

export const setNpcs = (mapKey: string, value: PersistedNpcs) =>
  tryLocalStorageSet(npcsKey(mapKey), JSON.stringify(value));

/** The npcs of some map, as left by the previous session */
export type PersistedNpcs = {
  /** Which of `npcs` was the player; `null` if there wasn't one */
  playerKey: null | string;
  npcs: PersistedNpc[];
};

export type PersistedNpc = {
  key: string;
  at: { x: number; y: number };
  /** Radians, CW from north viewed from above */
  angle: number;
  skinKey: string;
  /** Set when the npc was doing something e.g. sitting */
  decorKey?: string;
};
