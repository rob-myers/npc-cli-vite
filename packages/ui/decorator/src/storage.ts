import { createLocalStore, type LocalStore } from "@npc-cli/util/local-store";
import type { SvgZoomState } from "@npc-cli/util/use-svg-zoom";

/** What the panel keeps per World and map, under one localStorage key: `decorator:<world>:<map>` */
export type DecoratorMapState = {
  /** Where the map was left, panned and zoomed */
  view: null | SvgZoomState;
};

const stores = {} as Record<string, LocalStore<DecoratorMapState>>;

export function getDecoratorMapStore(worldKey: string, mapKey: string) {
  const key = `decorator:${worldKey}:map:${mapKey}`;
  return (stores[key] ??= createLocalStore<DecoratorMapState>(key, { view: null }));
}
