import type { WorldState } from "@npc-cli/ui__world";
import {
  type SpotsFile,
  SpotsFileSchema,
  spotAliasesOf,
  spotKeyRe,
  spotKindInk,
  spotsChangedEvent,
} from "@npc-cli/ui__world/spot.schema";
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

/** Each kind's colour, as the World's overlay draws it too */
export const inkOf = spotKindInk;

/** A spot, by its geomorph instance and its id there */
export type SpotPick = { gmId: number; id: number };

/** Its alias on this map, e.g. `g0r12-3` */
export const spotAlias = (file: SpotsFile, pick: SpotPick) => `g${pick.gmId}${spotAliasesOf(file)[pick.id]}`;

/** A spot's alias, e.g. `g0r12-3`, or its key, e.g. `g0s455`, as a pick, if this map has it */
export function parseSpotPick(
  text: string,
  w: WorldState,
  byGmKey: undefined | Record<string, SpotsFile>,
): null | SpotPick {
  const match = text.trim().toLowerCase().match(spotKeyRe);
  if (match === null) return null;
  const gmId = Number(match[1]);
  const file = byGmKey?.[w.gms[gmId]?.key];
  if (file === undefined) return null;
  const id = match[2] !== undefined ? Number(match[2]) : spotAliasesOf(file).indexOf(match[3]);
  return file.spots[id] === undefined ? null : { gmId, id };
}

/** Where a spot is in the World, from its geomorph's own space */
export function spotWorldPoint(w: WorldState, file: SpotsFile, pick: SpotPick) {
  const spot = file.spots[pick.id];
  const { a, b, c, d, e, f } = w.gms[pick.gmId].transform;
  return { x: a * spot.x + c * spot.y + e, y: b * spot.x + d * spot.y + f };
}
