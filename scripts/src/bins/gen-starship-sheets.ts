#!/usr/bin/env node

/**
 * Usage
 * ```sh
 * pnpm gen-starship-sheets
 * ```
 *
 * Assume
 * - public/assets.json exists
 * - public/starship-symbol/manifest.json exists
 */

import { AssetsSchema } from "@npc-cli/ui__world/assets.schema";
import z from "zod";
import assetsEncoded from "../../../packages/app/public/assets.json" with { type: "json" };

const assets = z.parse(AssetsSchema, assetsEncoded);

import { isHullSymbolImageKey, sguScaleSvgToPngFactor } from "@npc-cli/media/starship-symbol";
import { worldToSguScale } from "@npc-cli/ui__world/const";
import packRectangles from "../service/rects-packer.ts";

/** unflattened symbols with some obstacle */
const symbolsWithAnObstacle = Object.values(assets.symbol).filter(({ obstacles }) => obstacles.length > 0);
const scale = { hull: worldToSguScale, nonHull: worldToSguScale * sguScaleSvgToPngFactor };

const obstacleKeyToRect: Record<
  Geomorph.ObstacleKey,
  { width: number; height: number; data: Geomorph.ObstacleSheetRectCtxt }
> = Object.fromEntries(
  symbolsWithAnObstacle.flatMap(({ key, obstacles }) =>
    obstacles.map(
      (obstacle, obstacleId) =>
        [
          `${key} ${obstacleId}`,
          {
            width: obstacle.rect.width * (isHullSymbolImageKey(key) ? scale.hull : scale.nonHull),
            height: obstacle.rect.height * (isHullSymbolImageKey(key) ? scale.hull : scale.nonHull),
            data: { symbolKey: key, obstacleId, type: obstacle.meta.type, sheetId: -1 },
          },
        ] as const,
    ),
  ),
);

const { bins, width, height } = packRectangles(Object.values(obstacleKeyToRect), {
  logPrefix: "createObstaclesSheetJson",
  packedPadding: 2,
  // maxWidth: 1000,
  // maxHeight: 1000,
});

console.log("🚧 write to public/sheets.json", {
  symbolKeys: symbolsWithAnObstacle.map(({ key }) => key),
  bins,
  width,
  height,
});
