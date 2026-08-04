import { tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import { ambientIntensityKey, defaultAmbientIntensity, introEnabledKey, playerStorageKeyPrefix } from "../const";

export const getAmbientIntensity = () =>
  tryLocalStorageGetParsed<number>(ambientIntensityKey) ?? defaultAmbientIntensity;

export const setAmbientIntensity = (next: number) => tryLocalStorageSet(ambientIntensityKey, String(next));

export const getIntroEnabled = () => tryLocalStorageGetParsed<boolean>(introEnabledKey) ?? true;

export const setIntroEnabled = (next: boolean) => tryLocalStorageSet(introEnabledKey, String(next));

const playerKey = (mapKey: string) => `${playerStorageKeyPrefix}:${mapKey}`;

export const getPlayer = (mapKey: string) => tryLocalStorageGetParsed<PersistedPlayer>(playerKey(mapKey));

export const setPlayer = (mapKey: string, player: PersistedPlayer) =>
  tryLocalStorageSet(playerKey(mapKey), JSON.stringify(player));

/** The player of some map, as left by the previous session */
export type PersistedPlayer = {
  /** Which npc was the player; absent in blobs saved before this existed */
  key?: string;
  at: { x: number; y: number };
  /** Radians, CW from north viewed from above */
  angle: number;
  skinKey: string;
  /** Set when the player was doing something e.g. sitting */
  decorKey?: string;
};
