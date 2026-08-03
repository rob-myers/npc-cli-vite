import { tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import { ambientIntensityKey, defaultAmbientIntensity, introEnabledKey } from "../const";

export const getAmbientIntensity = () =>
  tryLocalStorageGetParsed<number>(ambientIntensityKey) ?? defaultAmbientIntensity;

export const setAmbientIntensity = (next: number) => tryLocalStorageSet(ambientIntensityKey, String(next));

export const getIntroEnabled = () => tryLocalStorageGetParsed<boolean>(introEnabledKey) ?? true;

export const setIntroEnabled = (next: boolean) => tryLocalStorageSet(introEnabledKey, String(next));
