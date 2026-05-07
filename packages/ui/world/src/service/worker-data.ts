import { helper } from "./helper";

export function getNavmeshPayload(gms: Geomorph.LayoutInstance[]): WW.GmGeomForNav[] {
  return gms.map(({ key, doors, bounds, determinant, gridRect, matrix, inverseMatrix, mat4, navDecomp }, gmId) => ({
    key,
    doorways: doors.map((connector, doorId) => ({
      gmId,
      doorId,
      polygon: connector.poly.clone().applyMatrix(matrix).geoJson,
    })),
    triangulation: navDecomp,
    worldBounds: bounds.clone().applyMatrix(matrix),
    determinant,
    gridRect: gridRect.json,
    inverseMat3: inverseMatrix.json,
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
