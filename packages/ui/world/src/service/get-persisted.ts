import { tryLocalStorageGetParsed } from "@npc-cli/util/legacy/generic";
import { ambientIntensityKey, defaultAmbientIntensity } from "../const";

export const getAmbientIntensity = () =>
  tryLocalStorageGetParsed<number>(ambientIntensityKey) ?? defaultAmbientIntensity;
