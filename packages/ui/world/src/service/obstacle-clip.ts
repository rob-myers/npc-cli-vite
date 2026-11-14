import { Mat, Vect } from "@npc-cli/util/geom";
import { geomService } from "@npc-cli/util/geom-service";
import { cos, int, ivec2, min, positionWorld, sin, textureLoad, vec2 } from "three/tsl";
import * as THREE from "three/webgpu";
import { embedXZMat4 } from "./geometry";

/** Metres wide, the white line along a top where it is cut against a wall */
export const cutLineWidth = 0.03;

/** `(cx, cz, a1, a2)` no point on the floor passes: one wall, far off */
export const neverClipped = [1e30, 0, 0, 0];

/** The back across a cut: plain, as the obstacle's inside would be */
export const clipBackTint = "#000";

/** One texel `(cx, cz, a1, a2)` per obstacle instance. A texture, as the skirts have no vertex buffer to spare */
export function createClipTex(count: number) {
  const tex = new THREE.DataTexture(new Float32Array(count * 4), count, 1, THREE.RGBAFormat, THREE.FloatType);
  return Object.assign(tex, { needsUpdate: true });
}

/**
 * Where an obstacle is cut at its room's edge, as `(cx, cz, a1, a2)` in world space: a point, and the outward angles of the walls through it.
 * One wall, or two meeting at a corner of the room, e.g. a sink run into it. Else `null`. See `docs/walls.md`
 */
export function clipOf(
  { origPoly, transform, meta }: Geomorph.LayoutObstacle,
  room: undefined | Geom.Poly,
  toWorld: Mat,
): null | number[] {
  // what spans an opening shows on both sides: a window's sill, a floor plate in a doorway
  if (room === undefined || meta.window === true || meta.floor === true) return null;
  const toGm = tmpMat.setMatrixValue(transform);
  // a wall begins at the room's edge, see-through or not
  const past = origPoly.outline.map((p) => toGm.transformPoint(Vect.from(p))).filter((p) => !room.contains(p));
  if (past.length === 0) return null;
  const centre = toGm.transformPoint(origPoly.rect.center);
  const edges = room.lineSegs; // read only now: it clones every edge
  /** Each corner's nearest edge of the room, the furthest past first, with its normal out of the room */
  const walls = past
    .map((p) => edges.map(([a, b]) => ({ a, b, dst: geomService.getClosestOnSeg(p, a, b).dst })))
    .map((near) => near.reduce((x, y) => (y.dst < x.dst ? y : x)))
    .sort((x, y) => y.dst - x.dst)
    .map(({ a, b }) => {
      const n = new Vect(a.y - b.y, b.x - a.x).normalize();
      return { a, b, n: n.dot(Vect.from(centre).sub(a)) > 0 ? n.scale(-1) : n };
    });
  const [{ a, b, n }] = walls;
  const shared = (w: (typeof walls)[number]) => [a, b].find((p) => p.equals(w.a) || p.equals(w.b));
  /** Another wall from a corner of the room, convex there: just past the first wall alone is outside it */
  const second = walls.find((w) => {
    const at = shared(w);
    const turns = Math.abs(w.n.x * n.y - w.n.y * n.x) > 1e-6;
    return at !== undefined && turns && !room.contains(at.clone().addScaled(n, 0.01).addScaled(w.n, -0.01));
  });
  const c = toWorld.transformPoint((second === undefined ? a : (shared(second) as Geom.Vect)).clone());
  const [a1, a2] = [n, (second ?? walls[0]).n].map((v) => toWorld.transformSansTranslate(v.clone()).angle);
  return [c.x, c.y, a1, a2];
}

/**
 * The skirts across where an instance is cut, facing into its room, from its outline in world space.
 * Its own back skirts lie past the cut. One per wall it is cut at
 */
export function clipBacksOf(corners: Geom.VectJson[], clips: Float32Array, instanceId: number) {
  const [cx, cz, ...angles] = clips.subarray(instanceId * 4, instanceId * 4 + 4);
  /** Each wall a millimetre on the kept side, `past(p)` how far past it */
  const walls = [...new Set(angles)].map((angle) => {
    const [nx, nz] = [Math.cos(angle), Math.sin(angle)];
    return { normal: { x: -nx, y: -nz }, past: (p: Geom.VectJson) => (p.x - cx) * nx + (p.y - cz) * nz + 0.001 };
  });
  const kept = walls.reduce(
    (outline, { past }) =>
      outline.flatMap((p, i) => {
        const q = outline[(i + 1) % outline.length];
        const [sp, sq] = [past(p), past(q)];
        const t = sp / (sp - sq);
        const cut = sp > 0 === sq > 0 ? [] : [{ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }];
        return sp > 0 ? cut : [p, ...cut];
      }),
    corners,
  );
  // its edges along each wall
  return walls.flatMap(({ normal, past }) =>
    kept.flatMap((from, i) => {
      const to = kept[(i + 1) % kept.length];
      const along = Math.abs(past(from)) < 1e-6 && Math.abs(past(to)) < 1e-6;
      return along && Vect.distanceBetween(from, to) > 1e-6 ? [{ from, to, normal }] : [];
    }),
  );
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

/** Metres this fragment is inside its obstacle's cut, negative past it: by the nearer of its walls */
export function insideClipBy(clipTex: THREE.DataTexture, instanceId: THREE.Node<"int">) {
  const clip = textureLoad(clipTex, ivec2(instanceId, int(0)));
  const rel = clip.xy.sub(positionWorld.xz);
  return min(rel.dot(vec2(cos(clip.z), sin(clip.z))), rel.dot(vec2(cos(clip.w), sin(clip.w))));
}

const tmpMat = new Mat();
const tmpMat4 = new THREE.Matrix4();
const tmpColor = new THREE.Color();
