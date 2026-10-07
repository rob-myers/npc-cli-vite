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

export function getRoomGraphPayload(gmRoomGraph: Graph.GmRoomGraph): Graph.GmRoomGraphJson {
  // not `plainJson()`: mid-search `astar.parent` points at another node, which cannot be cloned
  return {
    nodes: gmRoomGraph.nodesArray.map((node) => ({
      ...node,
      astar: { ...node.astar, parent: null, centroid: node.astar.centroid.json as Geom.Vect },
    })),
    edges: gmRoomGraph.edgesArray.map(({ src, dst }) => ({ src: src.id, dst: dst.id })),
  };
}

export function getPhysicsDoorsPayload(gms: Geomorph.LayoutInstance[]): WW.PhysicsDoorDef[] {
  return gms.flatMap((gm, gmId) =>
    gm.doors.map((door, doorId) => ({
      gdKey: helper.getGmDoorKey(gmId, doorId),
      center: gm.matrix.transformPoint(door.center.clone()),
      // 🔔 rapier has reverse angular convention
      angle: -gm.matrix.transformAngle(door.angle),
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
export function getRaycastPayload(gms: Geomorph.LayoutInstance[]): WW.RaycastSetupData {
  const gmPairs = [...new Set(gms.map(({ key }) => key))].map(
    (key) => [key, gms.find((g) => g.key === key) as Geomorph.LayoutInstance] as const,
  );

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

/** A rect or circle that senses whoever stands in it: tagged `collider`, or a shield */
export function isColliderDecor(d: Geomorph.Decor): d is Geomorph.DecorRect | Geomorph.DecorCircle {
  return (d.type === "rect" || d.type === "circle") && (d.meta.collider === true || Boolean(d.meta.shield));
}

/**
 * 🚧 must align collider creation with decor circle/rect creation
 * - userData is decor.meta
 * - colliderKey is always decor.key
 */
export function getDecorCollidersPayload(decor: Geomorph.Decor[]): WW.PhysicsColliderDef[] {
  return decor.flatMap((d) => {
    if (isColliderDecor(d) === false) return [];
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
        const { angle, baseRect } = geomService.polyToAngledRect(new Poly(d.points));
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
