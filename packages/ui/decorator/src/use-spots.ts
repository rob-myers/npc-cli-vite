import type { WorldState } from "@npc-cli/ui__world";
import { queryClientApi } from "@npc-cli/ui__world/query-client";
import { type SpotKind, type SpotsFile, SpotsFileSchema, spotsChangedEvent } from "@npc-cli/ui__world/spot.schema";
import { fetchParsed, getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";

/** Every geomorph key's spots on this map, refetched as the dev server remakes them. `undefined` until fetched */
export function useSpots(w: WorldState, enabled: boolean) {
  const gmKeys = [...new Set(w.gms.map((gm) => gm.key))];
  const byGmKey = useQuery({
    queryKey: ["spots", ...gmKeys],
    enabled,
    async queryFn() {
      const files = await Promise.all(
        gmKeys.map((gmKey) =>
          fetchParsed(`/spot/${gmKey}.json${getDevCacheBustQueryParam()}`, SpotsFileSchema).catch(() => null),
        ),
      );
      return Object.fromEntries(files.flatMap((file) => (file === null ? [] : [[file.gmKey, file]])));
    },
  }).data as undefined | Record<string, SpotsFile>;

  useEffect(() => {
    if (!import.meta.hot) return;
    const onChanged = () => queryClientApi.queryClient.invalidateQueries({ queryKey: ["spots"] });
    import.meta.hot.on(spotsChangedEvent, onChanged);
    return () => import.meta.hot?.off(spotsChangedEvent, onChanged);
  }, []);

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
