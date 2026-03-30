import { keys } from "@npc-cli/util/legacy/generic";
import z from "zod";
import { geomorphKeys, symbolByGroup } from "./const.ts";

export const StarShipSymbolImageKeySchema = z.literal(Object.values(symbolByGroup).flatMap((group) => keys(group)));
export type StarshipSymbolImageKey = z.infer<typeof StarShipSymbolImageKeySchema>;

export const StarShipGeomorphKeySchema = z.literal(geomorphKeys);
export type StarShipGeomorphKey = z.infer<typeof StarShipGeomorphKeySchema>;

export function isHullSymbolImageKey(imageKey: StarshipSymbolImageKey): imageKey is StarShipGeomorphKey {
  return imageKey.startsWith("g-");
}

type ExtractGeomorphNumber<T extends string> = T extends `g-${infer N}--${string}`
  ? N extends `${infer D extends number}`
    ? D
    : never
  : never;
export type StarshipGeomorphNumber = ExtractGeomorphNumber<StarShipGeomorphKey>;
export const StarShipGeomorphNumberSchema = z.literal(
  [...keys(symbolByGroup["geomorph-core"]), ...keys(symbolByGroup["geomorph-edge"])].map(getGeomorphNumber),
);
/** g-101--multipurpose -> g-101 -> 101 */
export function getGeomorphNumber(gmKey: StarShipGeomorphKey): StarshipGeomorphNumber {
  return Number(gmKey.split("--")[0].slice(2)) as StarshipGeomorphNumber;
}

export const StarshipSymbolPngsManifestSchema = z.object({
  byKey: z.record(
    StarShipSymbolImageKeySchema,
    z.object({
      key: StarShipSymbolImageKeySchema,
      group: z.literal(keys(symbolByGroup)),
      width: z.number(),
      height: z.number(),
    }),
  ),
});
export type StarshipSymbolPngsManifest = z.infer<typeof StarshipSymbolPngsManifestSchema>;
