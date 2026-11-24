import * as THREE from "three/webgpu";
import type { Npc } from "../components/npc";
import { corpseConfig } from "../const.npc";
import { bodyPart } from "./phaser-beam";
import { corpseColliderKey } from "./physics-bijection";

/**
 * Where a corpse lies, along their side then ahead from `x, z` as they face `ry`.
 * `hull` is their footprint, and `top` their torso's height.
 */
export type CorpseBody = { x: number; z: number; ry: number; hull: THREE.Vector2[]; top: number };

/** Puts a corpse's rect sensor round their body as it lies, and gives where it lies */
export function addCorpseCollider(npc: Npc): null | CorpseBody {
  const body = bodyOf(npc);
  if (body !== null) postCorpseCollider(npc, body);
  return body;
}

/** Where `npc`'s body lies, fitted round their parts as posed, e.g. a corpse's. `null` if none is found */
export function bodyOf(npc: Npc): null | CorpseBody {
  const [x, z, ry] = [npc.position.x, npc.position.z, npc.rotation.y];
  const points: THREE.Vector2[] = [];
  let top = 0;
  npc.group?.updateWorldMatrix(true, true);
  for (const name of corpseParts) {
    const found = bodyPart(npc, name);
    if (found === null) continue;
    const { min, max } = found.box;
    for (let i = 0; i < 8; i++) {
      const p = tmpCorner.set(i & 1 ? max.x : min.x, i & 2 ? max.y : min.y, i & 4 ? max.z : min.z);
      p.applyMatrix4(found.bone.matrixWorld);
      points.push(toBody(p.x - x, p.z - z, ry, new THREE.Vector2()));
      if (name !== "head") top = Math.max(top, p.y); // a big head would have them stand high on it
    }
  }
  return points.length === 0 ? null : { x, z, ry, hull: convexHull(points), top };
}

/** Posts the sensor round where `npc`'s corpse lies, e.g. again once the physics world is rebuilt */
export function postCorpseCollider(npc: Npc, { x, z, ry, hull }: CorpseBody) {
  const [side, ahead] = [
    { x: Math.cos(ry), y: -Math.sin(ry) },
    { x: -Math.sin(ry), y: -Math.cos(ry) },
  ];
  const rect = new THREE.Box2().setFromPoints(hull).expandByScalar(corpseConfig.margin);
  // a rect runs `width` along its angle from its corner, and `height` at right angles: here `side` and back
  npc.w.physics.worker.postMessage({
    type: "add-physics-colliders",
    colliders: [
      {
        type: "rect",
        colliderKey: corpseColliderKey(npc.key),
        x: x + rect.min.x * side.x + rect.max.y * ahead.x,
        y: z + rect.min.x * side.y + rect.max.y * ahead.y,
        width: rect.max.x - rect.min.x,
        height: rect.max.y - rect.min.y,
        angle: -ry,
        userData: { corpse: npc.key },
      },
    ],
  } satisfies WW.MsgToWorker);
}

/** Whether a corpse's body crosses the strip `length` along `way` from `from`, `half` either side of it */
export function bodyCrosses(body: CorpseBody, from: Geom.VectJson, way: Geom.VectJson, length: number, half: number) {
  const [c, s] = [Math.cos(body.ry), Math.sin(body.ry)];
  /** The hull along `way` then across it, from `from` */
  const hull = body.hull.map((v) => {
    const [dx, dz] = [body.x + v.x * c - v.y * s - from.x, body.z - v.x * s - v.y * c - from.y];
    return { a: dx * way.x + dz * way.y, b: dx * way.y - dz * way.x };
  });
  const strip = [
    { a: 0, b: -half },
    { a: 0, b: half },
    { a: length, b: half },
    { a: length, b: -half },
  ];
  // apart if either's edges separate them
  for (const [poly, other] of [
    [strip, hull],
    [hull, strip],
  ])
    for (let i = 0; i < poly.length; i++) {
      const [p, q] = [poly[i], poly[(i + 1) % poly.length]];
      const n = { a: q.b - p.b, b: p.a - q.a };
      const [lo, hi] = spanOf(poly, n);
      const [otherLo, otherHi] = spanOf(other, n);
      if (otherHi < lo || hi < otherLo) return false;
    }
  return true;
}

/** How far up a body's ramp `at` is: `0` off it, `1` from `ramp` inside its edge */
export function upRamp(hull: THREE.Vector2[], at: THREE.Vector2) {
  let depth = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const [a, b] = [hull[i], hull[(i + 1) % hull.length]];
    const [ex, ey] = [b.x - a.x, b.y - a.y];
    // anticlockwise, so its inside is on each edge's left
    depth = Math.min(depth, (ex * (at.y - a.y) - ey * (at.x - a.x)) / Math.hypot(ex, ey));
  }
  const u = THREE.MathUtils.clamp(depth / corpseConfig.ramp, 0, 1);
  return u * u * (3 - 2 * u);
}

/** A world offset `dx, dz` along one facing `ry`'s side then ahead */
export function toBody(dx: number, dz: number, ry: number, out: THREE.Vector2) {
  const [c, s] = [Math.cos(ry), Math.sin(ry)];
  return out.set(dx * c - dz * s, -dx * s - dz * c);
}

/** The parts a corpse's body is fitted round */
export const corpseParts = [
  ...["head", "chest", "stomach", "hips"],
  ...["leftarm", "rightarm", "leftforearm", "rightforearm"],
  ...["leftthigh", "rightthigh", "leftshin", "rightshin"],
];

/** The anticlockwise convex hull of `points` (Andrew's monotone chain) */
function convexHull(points: THREE.Vector2[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: THREE.Vector2[]) => {
    const out: THREE.Vector2[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop(); // the other half starts with it
    return out;
  };
  return [...half(sorted), ...half(sorted.reverse())];
}

/** The least and most of `points` along `n` */
function spanOf(points: { a: number; b: number }[], n: { a: number; b: number }) {
  const dots = points.map((p) => p.a * n.a + p.b * n.b);
  return [Math.min(...dots), Math.max(...dots)];
}

const tmpCorner = new THREE.Vector3();
