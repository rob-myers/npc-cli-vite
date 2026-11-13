import { Mat, Vect } from "@npc-cli/util/geom";
import { geomService } from "@npc-cli/util/geom-service";
import { int, ivec2, positionWorld, textureLoad } from "three/tsl";
import * as THREE from "three/webgpu";
import { embedXZMat4 } from "./geometry";

/** Metres wide, the white line along a top where it is cut against a wall */
export const cutLineWidth = 0.03;

/** `(nx, nz, d, 0)` no point on the floor passes */
export const neverClipped = [0, 0, Number.MAX_VALUE, 0];

/** The back across a cut: plain, as the obstacle's inside would be */
export const clipBackTint = "#000";

/** One texel `(nx, nz, d, 0)` per obstacle instance. A texture, as the skirts have no vertex buffer to spare */
export function createClipTex(count: number) {
  const tex = new THREE.DataTexture(new Float32Array(count * 4), count, 1, THREE.RGBAFormat, THREE.FloatType);
  return Object.assign(tex, { needsUpdate: true });
}

/**
 * The edge of its room an obstacle pokes past, as `(nx, nz, d, 0)` in world space, its normal out of the room.
 * One wall at most: e.g. a toilet moved out to widen its room's navmesh. Else `null`. See `docs/walls.md`
 */
export function clipLineOf(
  { origPoly, transform, meta }: Geomorph.LayoutObstacle,
  room: undefined | Geom.Poly,
  toWorld: Mat,
): null | number[] {
  // what spans an opening shows on both sides: a window's sill, a floor plate in a doorway
  if (room === undefined || meta.window === true || meta.floor === true) return null;
  const toGm = tmpMat.setMatrixValue(transform);
  const { rect } = origPoly;
  const centre = toGm.transformPoint({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
  // the corner furthest past its room's outline, and the outline's edge nearest it
  let found = null as null | { a: Geom.VectJson; b: Geom.VectJson; dst: number };
  let edges = null as null | Geom.Vect[][]; // read once, if at all: `lineSegs` clones every edge
  for (const p of origPoly.outline) {
    const corner = toGm.transformPoint({ x: p.x, y: p.y });
    if (room.contains(corner)) continue; // a wall begins at the room's edge, see-through or not
    let near = null as typeof found;
    for (const [a, b] of (edges ??= room.lineSegs)) {
      const { dst } = geomService.getClosestOnSeg(corner, a, b);
      if (near === null || dst < near.dst) near = { a, b, dst };
    }
    if (near !== null && (found === null || near.dst > found.dst)) found = near;
  }
  if (found === null) return null;
  const { a, b } = found;
  const n = new Vect(a.y - b.y, b.x - a.x).normalize();
  if ((centre.x - a.x) * n.x + (centre.y - a.y) * n.y > 0) n.scale(-1); // out of the room
  const at = toWorld.transformPoint({ x: a.x, y: a.y });
  toWorld.transformSansTranslate(n);
  return [n.x, n.y, n.x * at.x + n.y * at.y, 0];
}

/**
 * A skirt across where an instance is cut, facing into its room, from its outline in world space.
 * Its own back skirt lies past the cut. Else `null`
 */
export function clipBackOf(corners: Geom.VectJson[], clips: Float32Array, instanceId: number) {
  const line = clips.subarray(instanceId * 4, instanceId * 4 + 3);
  const [from, to] = cutAcross(corners, line);
  return to === undefined ? null : { from, to, normal: { x: -line[0], y: -line[1] } };
}

/** What `writeSkirt` writes into: `Obstacles`' skirt mesh and its per-instance arrays */
export type SkirtBuffers = {
  skirtInst: THREE.InstancedMesh;
  skirtObstacleIds: Float32Array;
  skirtNormals: Float32Array;
  skirtInfo: Float32Array;
};

/** Skirt `sId` from `from` to `to`, its normal `normal`, `dimY` tall up to `height` */
export function writeSkirt(
  buffers: SkirtBuffers,
  slots: THREE.InstancedBufferAttribute,
  sId: number,
  { from, to, normal }: { from: Geom.VectJson; to: Geom.VectJson; normal: Geom.VectJson },
  look: { slot: number; instanceId: number; height: number; dimY: number; kind: number; tint: string },
) {
  const [dx, dy] = [to.x - from.x, to.y - from.y];
  const len = Math.hypot(dx, dy);
  tmpMat.feedFromArray([dx, dy, -dy / len, dx / len, from.x, from.y]);
  slots.setXY(sId, look.slot, look.slot);
  buffers.skirtObstacleIds[sId] = look.instanceId; // a pick on a skirt picks its obstacle
  buffers.skirtNormals.set([normal.x, normal.y], sId * 2);
  buffers.skirtInfo.set([look.height, look.kind], sId * 2);
  buffers.skirtInst.setColorAt(sId, tmpColor.set(look.tint));
  buffers.skirtInst.setMatrixAt(
    sId,
    embedXZMat4(tmpMat, { yScale: look.dimY, yHeight: look.height - look.dimY, mat4: tmpMat4 }),
  );
}

/**
 * Where the clip line `(nx, nz, d)` crosses an outline in world space, a millimetre on the kept side.
 * Two points for the one wall an obstacle pokes into, else fewer
 */
function cutAcross(corners: Geom.VectJson[], [nx, nz, d]: Float32Array): Geom.VectJson[] {
  return corners.flatMap((p, i) => {
    const q = corners[(i + 1) % corners.length];
    const [sp, sq] = [p.x * nx + p.y * nz - d, q.x * nx + q.y * nz - d];
    if (sp > 0 === sq > 0) return [];
    const t = sp / (sp - sq);
    return [{ x: p.x + (q.x - p.x) * t - nx * 0.001, y: p.y + (q.y - p.y) * t - nz * 0.001 }];
  });
}

/** Metres this fragment is inside its obstacle's clip line, negative past it */
export function insideClipBy(clipTex: THREE.DataTexture, instanceId: THREE.Node<"int">) {
  const clip = textureLoad(clipTex, ivec2(instanceId, int(0)));
  return clip.z.sub(positionWorld.xz.dot(clip.xy));
}

const tmpMat = new Mat();
const tmpMat4 = new THREE.Matrix4();
const tmpColor = new THREE.Color();
