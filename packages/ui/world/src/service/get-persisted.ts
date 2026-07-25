/**
 * When we track via persisted data we may need to switch between it e.g. onchange theme.
 */
import { tryLocalStorageGetParsed } from "@npc-cli/util/legacy/generic";
import { ambientIntensityKey, defaultAmbientIntensity } from "../const";
import { helper } from "./helper";

export const getAmbientIntensity = (themeKey: string) =>
  helper.isLightTheme(themeKey)
    ? 1
    : (tryLocalStorageGetParsed<number>(ambientIntensityKey) ?? defaultAmbientIntensity);
