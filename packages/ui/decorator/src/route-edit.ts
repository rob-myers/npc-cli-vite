import type { WorldState } from "@npc-cli/ui__world";
import type { RouteEntry } from "@npc-cli/ui__world/scenario.schema";

/** `at` on the navmesh, to the cm, else `null` if none is near */
export function snapped(w: WorldState, at: Geom.VectJson): null | [number, number] {
  const found = w.npc.getClosestPoly(at, 0.5);
  return found.success ? [cm(found.position[0]), cm(found.position[2])] : null;
}

/** With point `i` at `to` */
export function movedPoint(route: RouteEntry, i: number, to: [number, number]): RouteEntry {
  return { ...route, points: route.points.map((p, j) => (j === i ? to : p)) };
}

/** With `at` after point `i` */
export function inserted(route: RouteEntry, i: number, at: [number, number]): RouteEntry {
  return { ...route, points: route.points.toSpliced(i + 1, 0, at) };
}

/** Without point `i`, keeping `minPoints` */
export function removed(route: RouteEntry, i: number): RouteEntry {
  return route.points.length <= minPoints ? route : { ...route, points: route.points.toSpliced(i, 1) };
}

/** Its legs, each from point `i`: a cycle's last returns to the first */
export function legsOf(route: RouteEntry): { i: number; a: [number, number]; b: [number, number] }[] {
  const { points } = route;
  const count = route.cycle ? points.length : points.length - 1;
  return Array.from({ length: count }, (_, i) => ({ i, a: points[i], b: points[(i + 1) % points.length] }));
}

/** A route keeps this many points */
export const minPoints = 2;

const cm = (x: number) => Math.round(x * 100) / 100;
