import { helper } from "./helper";

/**
 * We provide local coords unlike `getNavmeshPayload`.
 *
 * Raycasting currently only supports:
 * - static walls determined by gmKey
 * - dynamic doors checked in main thread
 */
export function getRaycastPayload(gms: Geomorph.LayoutInstance[]): WW.SetupPhysicsWorld["rayCast"] {
  const gmPairs = new Set(gms.map(({ key }) => key))
    .values()
    .map((key) => [key, gms.find((g) => g.key === key) as Geomorph.LayoutInstance] as const);

  return Object.fromEntries(
    gmPairs.map(([gmKey, { walls, doors }]) => [
      gmKey,
      {
        key: gmKey,
        doors: doors.map(({ poly }) => poly.geoJson),
        walls: walls.map((poly) => poly.geoJson),
        // 🚧 some obstacles?
      },
    ]),
  );
}

/**
 * We transform everything into world coords except `triangulation`.
 */
export function getNavmeshPayload(gms: Geomorph.LayoutInstance[]): WW.GmGeomForNav[] {
  return gms.map(({ key, doors, bounds, determinant, gridRect, matrix, inverseMatrix, mat4, navDecomp }, gmId) => ({
    key,
    doorways: doors.map((connector, doorId) => ({
      gmId,
      doorId,
      polygon: connector.poly.clone().applyMatrix(matrix).geoJson,
    })),
    /** In local coords unlike everything else */
    triangulation: navDecomp,
    worldBounds: bounds.clone().applyMatrix(matrix),
    determinant,
    gridRect: gridRect.json,
    inverseMat3: inverseMatrix.json,
    mat3: matrix.json,
    mat4Array: mat4.toArray(),
  }));
}

export function getPhysicsDoorData(gms: Geomorph.LayoutInstance[]): WW.PhysicsDoorDef[] {
  return gms.flatMap((gm, gmId) =>
    gm.doors.map((door, doorId) => ({
      gdKey: helper.getGmDoorKey(gmId, doorId),
      center: gm.matrix.transformPoint(door.center.clone()),
      angle: gm.matrix.transformAngle(door.angle),
      baseWidth: door.baseRect.width,
      baseHeight: door.baseRect.height,
    })),
  );
}
