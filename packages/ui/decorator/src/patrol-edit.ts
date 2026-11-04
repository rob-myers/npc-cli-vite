import type { WorldState } from "@npc-cli/ui__world";
import type { PatrolEntry } from "@npc-cli/ui__world/scenario.schema";

/** `at` on the navmesh, to the cm, else `null` if none is near */
export function snapped(w: WorldState, at: Geom.VectJson): null | [number, number] {
  const found = w.npc.getClosestPoly(at, 0.5);
  return found.success ? [cm(found.position[0]), cm(found.position[2])] : null;
}

/** With point `i` at `to` */
export function movedPoint(patrol: PatrolEntry, i: number, to: [number, number]): PatrolEntry {
  return { ...patrol, points: patrol.points.map((p, j) => (j === i ? to : p)) };
}

/** With `at` after point `i` */
export function inserted(patrol: PatrolEntry, i: number, at: [number, number]): PatrolEntry {
  return { ...patrol, points: patrol.points.toSpliced(i + 1, 0, at) };
}

/** Without point `i`, keeping `minPoints` */
export function removed(patrol: PatrolEntry, i: number): PatrolEntry {
  return patrol.points.length <= minPoints ? patrol : { ...patrol, points: patrol.points.toSpliced(i, 1) };
}

/** Its legs, each from point `i`: a cycle's last returns to the first */
export function legsOf(patrol: PatrolEntry): { i: number; a: [number, number]; b: [number, number] }[] {
  const { points } = patrol;
  const count = patrol.cycle ? points.length : points.length - 1;
  return Array.from({ length: count }, (_, i) => ({ i, a: points[i], b: points[(i + 1) % points.length] }));
}

/** A patrol keeps this many points */
export const minPoints = 2;

const cm = (x: number) => Math.round(x * 100) / 100;
