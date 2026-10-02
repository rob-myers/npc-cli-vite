import { useCallback, useSyncExternalStore } from "react";
import type { State as WorldState } from "../components/World";
import { queryClientApi } from "./query-client";

/**
 * A World's state, for another panel, from the query cache it puts itself in under its key. Read
 * off the cache's own events rather than `useQuery`: the World REMOVES its query on unmount and sets
 * a new one on remount, e.g. over HMR, and an observer of the removed one would wait forever
 */
export function useWorld(worldKey: string): WorldState | undefined {
  const subscribe = useCallback((onChange: () => void) => queryClientApi.queryCache.subscribe(onChange), []);
  return useSyncExternalStore(subscribe, () => {
    const w = queryClientApi.get([worldKey]) as WorldState | undefined;
    // `undefined` until it has geomorphs: the same object either side would not re-render
    return w !== undefined && w.gms.length > 0 ? w : undefined;
  });
}
