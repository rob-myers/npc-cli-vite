import { useWorld } from "@npc-cli/ui__world/use-world";
import { useCallback, useSyncExternalStore } from "react";

/** The items jsh mounted on the World, e.g. `sidestep`'s, as they change */
export function useSkipNetItems(worldKey: string): JshCli.SkipNetItem[] {
  const w = useWorld(worldKey);
  const subscribe = useCallback((onChange: () => void) => w?.skipNet?.subscribe(onChange) ?? noop, [w]);
  return useSyncExternalStore(subscribe, () => w?.skipNet?.items ?? noItems);
}

const noItems: JshCli.SkipNetItem[] = [];
const noop = () => {};
