import { Mat, Poly } from "@npc-cli/util/geom"; // 🔔 @npc-cli/util breaks worker via react-refresh window undefined
import { Polygon, System } from "detect-collisions";

/** The geomorphs as of the last navmesh request, whose transforms a raycast needs */
let gmGeoms: WW.GmGeomForNav[] = [];
const gmRayCast: { [gmKey: string]: System } = {};

export function createGmRayCastSystems(gmKeyToData: WW.RaycastSetupData, nextGmGeoms: WW.GmGeomForNav[]) {
  gmGeoms = nextGmGeoms;

  for (const { key: gmKey, walls, doors } of Object.values(gmKeyToData)) {
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

    // 🚧 some obstacles?
  }
}

export function sendRaycastResult(msg: WW.GetRaycast) {
  const { src, dst, gmId } = msg;

  let hit: null | Geom.VectJson = null;
  const gmDoorIds: Geomorph.GmDoorId[] = [];

  const gm = gmGeoms[gmId];
  const mat = new Mat(gm.mat3);
  const inverseMat = new Mat(gm.inverseMat3);

  const localSrc = inverseMat.transformPoint({ ...src });
  const localDst = inverseMat.transformPoint({ ...dst });
  const result = gmRayCast[gm.key].raycast(localSrc, localDst, (body) => {
    if (body.userData.type === "door") {
      gmDoorIds.push({
        gmId,
        doorId: body.userData.doorId,
        gdKey: `g${gmId}d${body.userData.doorId}`,
      });
      return false; // continue past door
    }
    return true;
  });
  if (result !== undefined) {
    // transform back into world coords
    hit = mat.transformPoint(result.point);
  }

  self.postMessage({
    type: "raycast-result",
    uid: msg.uid,
    hit: hit,
    gmDoorIds,
  } satisfies WW.RaycastResultResponse);
}
