import { ExhaustiveError } from "@npc-cli/util";
import { gmFloorExtraScale, worldToSguScale } from "../const";

/**
 * - Object pick red amounts (0 ≤ r ≤ 255).
 * - Spaced out for visual debug.
 */
export const OBJECT_PICK_KEY_TO_RED = {
  floor: 25,
  ceiling: 50,
  door: 75,
  wall: 100,
  obstacle: 125,
  npc: 150,
  decor: 175,
  /** Decor points optionally shown via <Debug> */
  debugPoint: 200,
  /** Runtime decor can be added or removed */
  runtimeDecor: 225,
} as const;

export type ObjectPickKey = keyof typeof OBJECT_PICK_KEY_TO_RED;

type ObjectPickRedNumber = (typeof OBJECT_PICK_KEY_TO_RED)[keyof typeof OBJECT_PICK_KEY_TO_RED];

const objectPickRedToKey = Object.fromEntries(Object.entries(OBJECT_PICK_KEY_TO_RED).map(([k, v]) => [v, k])) as Record<
  ObjectPickRedNumber,
  keyof typeof OBJECT_PICK_KEY_TO_RED
>;

/**
 * Decode RGBA pixel to `{ type, instanceId }` or `null`.
 */
export function decodePick(r: number, g: number, b: number) {
  const type = objectPickRedToKey[r as ObjectPickRedNumber];
  if (!type) return null;
  const instanceId = (g << 8) | b;
  switch (type) {
    case "ceiling":
      return { type, instanceId };
    case "floor":
      return { type, instanceId };
    case "door":
      return { type, instanceId };
    case "wall":
      return { type, instanceId };
    case "obstacle":
      return { type, instanceId };
    case "npc":
      return { type, instanceId };
    case "decor":
      return { type, instanceId };
    case "debugPoint":
      return { type, instanceId };
    case "runtimeDecor":
      return { type, instanceId };
    default:
      throw new ExhaustiveError(type);
  }
}

const worldToCanvas = worldToSguScale * gmFloorExtraScale;

/** Look up roomId from world-space local position using room canvas in gmsData */
export function pickRoomId(
  gmData: Geomorph.GmData,
  localX: number,
  localY: number,
  bounds: Geom.RectJson,
): number | null {
  const ct = gmData.roomHitCt;
  if (!ct) return null;
  const cx = Math.floor((localX - bounds.x) * worldToCanvas);
  const cy = Math.floor((localY - bounds.y) * worldToCanvas);
  if (cx < 0 || cy < 0 || cx >= ct.canvas.width || cy >= ct.canvas.height) return null;
  const pixel = ct.getImageData(cx, cy, 1, 1).data;
  const roomId = pixel[0] - 1;
  return roomId >= 0 ? roomId : null;
}
