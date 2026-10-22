/**
 * The nav worker's raycasts. Two kinds, each against relatively few bodies:
 * 1. within a single geomorph, in its own space: its static walls, doors and obstacles;
 * 2. across the whole world: every shield.
 *
 * The main thread may ask for (1) more than once for a single ray, a leg a geomorph, but usually not
 */
import { Mat, Poly } from "@npc-cli/util/geom"; // 🔔 @npc-cli/util breaks worker via react-refresh window undefined
import { type Body, intersectLinePolygon, type Line, Polygon, System } from "detect-collisions";

/** The geomorphs as of the last navmesh request, whose transforms a raycast needs */
let gmGeoms: WW.GmGeomForNav[] = [];
const gmRayCast: { [gmKey: string]: System } = {};

/** The shields, in world space: kept apart, as a navmesh request clears the geomorphs' own */
const shieldSystem = new System();

export function setRayCastShields({ shields }: Extract<WW.MsgToNavWorker, { type: "set-raycast-shields" }>) {
  shieldSystem.clear();
  for (const { key, points } of shields) {
    shieldSystem.insert(new Polygon({ x: 0, y: 0 }, points, { isStatic: true, userData: { key } }));
  }
}

export function createGmRayCastSystems(gmKeyToData: WW.RaycastSetupData, nextGmGeoms: WW.GmGeomForNav[]) {
  gmGeoms = nextGmGeoms;

  for (const { key: gmKey, walls, doors, obstacles } of Object.values(gmKeyToData)) {
    // construct system per geomorph
    const system = (gmRayCast[gmKey] ??= new System());
    system.clear();

    // Geomorph.Layout not Geomorph.LayoutInstance
    const zero = { x: 0, y: 0 };

    walls
      .map((json) => Poly.from(json))
      .forEach((wall, wallId) =>
        system.insert(new Polygon(zero, wall.outline, { isStatic: true, userData: { type: "wall", wallId } })),
      );
    doors
      .map((json) => Poly.from(json))
      .forEach((door, doorId) =>
        system.insert(new Polygon(zero, door.outline, { isStatic: true, userData: { type: "door", doorId } })),
      );
    for (const { outline, ...obstacle } of obstacles) {
      const poly = Poly.from(outline);
      system.insert(
        new Polygon(zero, poly.outline, { isStatic: true, userData: { type: "obstacle", poly, obstacle } }),
      );
    }
  }
}

/**
 * One leg of a ray, within geomorph `gmId`. Walls stop it. Doors, obstacles and shields do not: each it reaches is
 * named, nearest first, and the main thread decides — it knows which doors stand open, and whose phaser is tuned
 */
export function sendRaycastResult({ uid, src, dst, gmId }: WW.GetRaycast) {
  const gm = gmGeoms[gmId];
  const [toWorld, toLocal] = [new Mat(gm.mat3), new Mat(gm.inverseMat3)];
  const localSrc = toLocal.transformPoint({ ...src });

  // walls and doors are in their geomorph's own space, shields in the world's
  const local = cast(gmRayCast[gm.key], localSrc, toLocal.transformPoint({ ...dst }), isNotWall);
  const world = cast(shieldSystem, { ...src }, { ...dst }, () => true);
  /** Metres to the wall that stopped it, the same in either space: nothing beyond counts */
  const reach =
    local.hit === undefined ? Infinity : Math.hypot(local.hit.point.x - localSrc.x, local.hit.point.y - localSrc.y);
  const gmDoorIds: Geomorph.GmDoorId[] = [];
  const obstacles: WW.RaycastObstacle[] = [];
  for (const { body, dist } of nearestFirst(local.passed, reach)) {
    const { userData } = body;
    if (userData.type === "door")
      gmDoorIds.push({ gmId, doorId: userData.doorId, gdKey: `g${gmId}d${userData.doorId}` });
    else if (userData.poly.contains(localSrc) === false) obstacles.push({ ...userData.obstacle, dist });
  }

  self.postMessage({
    type: "raycast-result",
    uid,
    hit: local.hit === undefined ? null : toWorld.transformPoint(local.hit.point),
    gmDoorIds,
    obstacles,
    shields: nearestFirst(world.passed, reach).map(({ body }) => body.userData.key),
  } satisfies WW.RaycastResultResponse);
}

const isNotWall = (body: Body) => body.userData.type !== "wall";

/** A body the ray went on past, and how far along it met it */
type Passed = { body: Body; dist: number };

/** Casts through `system`: what `passes` is noted and gone past, anything else stops it — `hit`, if anything did */
function cast(system: System, src: Geom.VectJson, dst: Geom.VectJson, passes: (body: Body) => boolean) {
  const passed: Passed[] = [];
  const hit = system.raycast(src, dst, (body, ray) => {
    if (passes(body) === false) return true;
    passed.push({ body, dist: distanceAlong(ray as Line, body) });
    return false;
  });
  return { hit, passed };
}

/** How far along the ray it meets `body` — `0` if it never crosses its edge, so lies inside it */
function distanceAlong(ray: Line, body: Body) {
  const { start } = ray;
  const dists = intersectLinePolygon(ray, body as Polygon).map((p) => Math.hypot(p.x - start.x, p.y - start.y));
  return dists.length === 0 ? 0 : Math.min(...dists);
}

/** Those within `reach`, nearest first: the library hands them over in no order, and from beyond a wall too */
function nearestFirst(passed: Passed[], reach: number) {
  return passed.filter(({ dist }) => dist <= reach).sort((a, b) => a.dist - b.dist);
}
