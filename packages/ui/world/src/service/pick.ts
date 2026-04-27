import { gmFloorExtraScale, worldToSguScale } from "../const";

/** Object type IDs — spaced out for visual debug */
export const PICK_TYPE = { floor: 25, ceiling: 50, door: 75, wall: 100, obstacle: 125, npc: 150 } as const;

export type ObjectPickKey = keyof typeof PICK_TYPE;

type PickType = (typeof PICK_TYPE)[keyof typeof PICK_TYPE];
const pickTypeToName = Object.fromEntries(Object.entries(PICK_TYPE).map(([k, v]) => [v, k])) as Record<
  PickType,
  keyof typeof PICK_TYPE
>;

/** Decode RGBA pixel → { type, instanceId } or null */
export function decodePick(r: number, g: number, b: number) {
  const type = pickTypeToName[r as PickType];
  if (!type) return null;
  const instanceId = (g << 8) | b;
  return { type, instanceId };
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
