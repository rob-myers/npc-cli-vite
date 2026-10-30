import type * as THREE from "three/webgpu";
import type { Npc } from "../components/npc";
import { type PartHit, partOnRay } from "./phaser-beam";

/** A shooter's aim: where it starts on the ground, its world bearing, the muzzle's height, and its tilt up */
export type Aim = { from: Geom.VectJson; bearing: number; y: number; pitch: number };

/** `aim` as a ray from the muzzle, pitched */
export function aimToRay(aim: Aim, out: THREE.Ray) {
  const { from, bearing, y, pitch } = aim;
  out.origin.set(from.x, y, from.y);
  out.direction.set(-Math.sin(bearing) * Math.cos(pitch), Math.sin(pitch), -Math.cos(bearing) * Math.cos(pitch));
  return out;
}

/** The point `dist` metres along the ground on `aim`, at its pitched height */
export function alongAim(aim: Aim, dist: number, out: THREE.Vector3) {
  const { from, bearing, y, pitch } = aim;
  return out.set(from.x - Math.sin(bearing) * dist, y + dist * Math.tan(pitch), from.y - Math.cos(bearing) * dist);
}

/**
 * The nearest of `npcs`, bar `exclude`, with a part of `bones` that `ray` meets (`partOnRay`).
 * Where it meets them is written to `out`. Nothing between counts
 */
export function npcOnRay(ray: THREE.Ray, npcs: Iterable<Npc>, exclude: string, bones: Iterable<string>, out: PartHit) {
  let best: null | Npc = null;
  for (const npc of npcs) {
    if (npc.key === exclude) continue;
    const hit = partOnRay(npc, ray, bones);
    if (hit === null || (best !== null && hit.dist >= out.dist)) continue;
    best = npc;
    Object.assign(out, { part: hit.part, dist: hit.dist });
    out.local.copy(hit.local);
    out.point.copy(hit.point);
  }
  return best;
}
