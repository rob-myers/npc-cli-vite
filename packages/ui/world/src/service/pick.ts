import { float, instanceIndex, output, uniform, vec4 } from "three/tsl";
import { gmFloorExtraScale, worldToSguScale } from "../const";

// 🚧 what about multiple worlds?
/** Shared uniform — 0 = normal render, 1 = pick render */
export const objectPick = uniform(0);

/** Object type IDs — spaced out for visual debug */
export const PICK_TYPE = { floor: 25, ceiling: 50, door: 75, wall: 100, obstacle: 125, npc: 150 } as const;

export type ObjectPickKey = keyof typeof PICK_TYPE;

type PickType = (typeof PICK_TYPE)[keyof typeof PICK_TYPE];
const pickTypeToName = Object.fromEntries(Object.entries(PICK_TYPE).map(([k, v]) => [v, k])) as Record<
  PickType,
  keyof typeof PICK_TYPE
>;

/**
 * TSL node for `outputNode`: when objectPick==1, outputs raw unlit pick color;
 * otherwise passes through the standard lit `output`.
 */
export function withPickOutput(typeId: number) {
  const idx = float(instanceIndex);
  const pickVec = vec4(float(typeId).div(255), idx.div(256).floor().div(255), idx.mod(256).div(255), output.a);
  return objectPick.equal(1).select(pickVec, output);
}

/** Like `withPickOutput` but uses a uniform instead of `instanceIndex` (for non-instanced meshes). */
export function withPickOutputId(typeId: number, idUniform: ReturnType<typeof uniform<number>>) {
  const idx = float(idUniform);
  const pickVec = vec4(float(typeId).div(255), idx.div(256).floor().div(255), idx.mod(256).div(255), output.a);
  return objectPick.equal(1).select(pickVec, output);
}

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
  const ct = gmData.roomCanvas;
  if (!ct) return null;
  const cx = Math.floor((localX - bounds.x) * worldToCanvas);
  const cy = Math.floor((localY - bounds.y) * worldToCanvas);
  if (cx < 0 || cy < 0 || cx >= ct.canvas.width || cy >= ct.canvas.height) return null;
  const pixel = ct.getImageData(cx, cy, 1, 1).data;
  const roomId = pixel[0] - 1;
  return roomId >= 0 ? roomId : null;
}
