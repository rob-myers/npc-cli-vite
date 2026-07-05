import { ExhaustiveError } from "@npc-cli/util/exhaustive-error";
import { Poly } from "@npc-cli/util/geom";
import { geomService } from "@npc-cli/util/geom-service";
import { helper } from "./helper";

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

export function getPhysicsDoorsPayload(gms: Geomorph.LayoutInstance[]): WW.PhysicsDoorDef[] {
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
 * 🚧 must align collider creation with decor circle/rect creation
 * - userData is decor.meta
 * - decor.meta.collider must be `true`
 * - colliderKey is always decor.key
 */
export function getRuntimeCollidersPayload(byKey: Record<string, Geomorph.Decor>): WW.PhysicsColliderDef[] {
  return Object.values(byKey).flatMap((d) => {
    if (d.type === "point" || d.type === "quad") {
      return [];
    }

    if (d.meta.collider !== true) {
      return [];
    }

    const colliderKey = d.key;

    switch (d.type) {
      case "circle": {
        return {
          type: "circle",
          colliderKey,
          radius: d.radius,
          x: d.center.x,
          y: d.center.y,
          userData: { ...d.meta },
        };
      }
      case "rect": {
        const poly = new Poly(d.points);
        const { angle, baseRect } = geomService.polyToAngledRect(poly);
        console.log({
          poly,
          angle,
          baseRect,
        });

        return {
          type: "rect",
          colliderKey,
          width: baseRect.width,
          height: baseRect.height,
          angle,
          x: baseRect.x,
          y: baseRect.y,
          userData: { ...d.meta },
        };
      }
      default:
        throw new ExhaustiveError(d);
    }
  });
}
