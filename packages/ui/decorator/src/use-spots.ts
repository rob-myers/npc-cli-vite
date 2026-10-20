import type { WorldState } from "@npc-cli/ui__world";
import { type SpotKind, type SpotsFile, SpotsFileSchema, spotsChangedEvent } from "@npc-cli/ui__world/spot.schema";
import { fetchParsed, getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
import { useEffect, useState } from "react";

/**
 * Every geomorph key's spots on this map, refetched as the dev server remakes them. `undefined` until fetched.
 * Fetched in an effect, not `useQuery`: a query added mid-render wakes every `useWorld`, which reads the query cache
 */
export function useSpots(w: WorldState, enabled: boolean) {
  const gmKeys = [...new Set(w.gms.map((gm) => gm.key))].join(" ");
  const [byGmKey, setByGmKey] = useState<undefined | Record<string, SpotsFile>>();

  useEffect(() => {
    if (enabled === false) return;
    let gone = false;
    const load = async () => {
      const files = await Promise.all(
        gmKeys
          .split(" ")
          .map((gmKey) =>
            fetchParsed(`/spot/${gmKey}.json${getDevCacheBustQueryParam()}`, SpotsFileSchema).catch(() => null),
          ),
      );
      if (gone === false) setByGmKey(Object.fromEntries(files.flatMap((f) => (f === null ? [] : [[f.gmKey, f]]))));
    };
    void load();
    import.meta.hot?.on(spotsChangedEvent, load);
    return () => {
      gone = true;
      import.meta.hot?.off(spotsChangedEvent, load);
    };
  }, [enabled, gmKeys]);

  return byGmKey;
}

/** Each kind's colour, a mid tone read on either theme */
export const inkOf: Record<SpotKind, string> = {
  doable: "#a970ff",
  door: "#f0a030",
  corner: "#40c0e0",
  cover: "#40d080",
  wall: "#8090a0",
  decor: "#e070b0",
  fill: "#c0c040",
};

/** A spot, by its geomorph instance and its id there */
export type SpotPick = { gmId: number; id: number };
