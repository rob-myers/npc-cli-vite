import RAPIER, { ColliderDesc } from "@dimforge/rapier3d-compat";
import { hashText } from "@npc-cli/util/legacy/generic";
import z from "zod";
import { AssetsSchema } from "../assets.schema";
import { createLayoutInstance } from "../service/geomorph";
import { helper } from "../service/helper";
import { type PhysicsBijection, workerStore } from "./worker.store";

const wallHeight: typeof import("../const")["wallHeight"] = 2;
const geomorphGridMeters: typeof import("../const")["geomorphGridMeters"] = 1.5;
const sguToWorldScale = (1 / 60) * geomorphGridMeters;
const wallOutset = 10 * sguToWorldScale;
const unitYAxis = { x: 0, y: 1, z: 0 } as const;

/**
 * Convert physics `bodyKey` into a number i.e. `bodyUid`,
 * for "more efficient" messaging between worker and main thread.
 *
 * We also record the correspondence in two dictionaries.
 * @param {WW.PhysicsBodyKey} bodyKey
 * @param {PhysicsBijection} lookups
 * @returns {number}
 */
export function addBodyKeyUidRelation(bodyKey: WW.PhysicsBodyKey, lookups: PhysicsBijection) {
  const bodyUid = hashText(bodyKey);
  lookups.bodyKeyToUid[bodyKey] = bodyUid;
  lookups.bodyUidToKey[bodyUid] = bodyKey;
  return bodyUid;
}

/**
 * "nearby" door sensors: one per door.
 */
function createDoorSensors() {
  const state = workerStore.getState();

  return state.gms.map((gm, gmId) =>
    gm.doors.flatMap((door, doorId) => {
      const center = gm.matrix.transformPoint(door.center.clone());
      const angle = gm.matrix.transformAngle(door.angle);
      const gdKey = helper.getGmDoorKey(gmId, doorId);
      const nearbyKey = `nearby ${gdKey}` as const;

      const nearbyDef = {
        width: door.baseRect.width,
        height: door.baseRect.height + 6 * wallOutset,
        // height: door.baseRect.height + 2 * wallOutset,
        angle,
      };
      // const insideDef = {
      //   width: (door.baseRect.width - 2 * wallOutset),
      //   height: door.baseRect.height,
      //   angle,
      // };

      return [
        createRigidBody({
          type: RAPIER.RigidBodyType.Fixed,
          geomDef: {
            type: "rect",
            width: nearbyDef.width,
            height: nearbyDef.height,
          },
          position: { x: center.x, y: wallHeight / 2, z: center.y },
          angle,
          userData: {
            bodyKey: nearbyKey,
            bodyUid: addBodyKeyUidRelation(nearbyKey, state),
            type: "cuboid",
            width: nearbyDef.width,
            depth: nearbyDef.height,
            angle,
          },
        }),

        // 🔔 maybe need "inside door sensor" too
      ];
    }),
  );
}

export function createRigidBody({
  type,
  geomDef,
  position,
  angle,
  userData,
}: {
  type: RAPIER.RigidBodyType.Fixed | RAPIER.RigidBodyType.KinematicPositionBased;
  geomDef: WW.PhysicsBodyGeom;
  position: import("three").Vector3Like;
  angle?: number;
  userData: WW.PhysicsUserData;
}) {
  const state = workerStore.getState();

  const bodyDescription = new RAPIER.RigidBodyDesc(type).setCanSleep(true).setCcdEnabled(false);

  const colliderDescription = (
    geomDef.type === "circle"
      ? ColliderDesc.cylinder(wallHeight / 2, geomDef.radius)
      : ColliderDesc.cuboid(geomDef.width / 2, wallHeight / 2, geomDef.height / 2)
  )
    .setDensity(0)
    .setFriction(0)
    .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
    .setRestitution(0)
    .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
    .setSensor(true)
    // .setCollisionGroups(1) // 👈 breaks things
    .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
    .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.DEFAULT | RAPIER.ActiveCollisionTypes.KINEMATIC_FIXED)
    .setEnabled(true);

  const rigidBody = state.world.createRigidBody(bodyDescription);
  const collider = state.world.createCollider(colliderDescription, rigidBody);

  collider.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
  collider.setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.DEFAULT | RAPIER.ActiveCollisionTypes.KINEMATIC_FIXED);

  rigidBody.userData = userData;

  state.bodyKeyToBody.set(userData.bodyKey, rigidBody);
  state.bodyKeyToCollider.set(userData.bodyKey, collider);
  state.bodyHandleToKey.set(rigidBody.handle, userData.bodyKey);

  if (typeof angle === "number") {
    rigidBody.setRotation(getQuaternionFromAxisAngle(unitYAxis, angle), false);
  }
  rigidBody.setTranslation(position, false);

  return rigidBody as RAPIER.RigidBody & { userData: WW.PhysicsUserData };
}

/**
 * Assumes axis is normalized
 * @source https://github.com/mrdoob/three.js/blob/c3f685f49d7a747397d44b8f9fedd4fcec792fa7/src/math/Quaternion.js#L275
 */
function getQuaternionFromAxisAngle(axis: { x: number; y: number; z: number }, angle: number) {
  const halfAngle = angle / 2;
  const s = Math.sin(halfAngle);
  return {
    x: axis.x * s,
    y: axis.y * s,
    z: axis.z * s,
    w: Math.cos(halfAngle),
  };
}

/**
 * Format:
 * - `['npc', npcKey]`
 * - `['circle', decorKey]`
 * - `['rect', decorKey]`
 * - `['nearby', gmDoorKey]`
 */
export function parsePhysicsBodyKey(bodyKey: WW.PhysicsBodyKey): WW.PhysicsParsedBodyKey {
  return bodyKey.split(" ") as WW.PhysicsParsedBodyKey;
}

export function sendPhysicsDebugData() {
  const state = workerStore.getState();
  const { vertices } = state.world.debugRender();

  const physicsDebugData = state.world.bodies.getAll().map((x) => ({
    parsedKey: parsePhysicsBodyKey((x.userData as WW.PhysicsUserData).bodyKey),
    userData: x.userData as WW.PhysicsUserData,
    position: { ...x.translation() },
    enabled: x.isEnabled(),
  }));

  // debug({physicsDebugData});
  self.postMessage({
    type: "physics-debug-data-response",
    items: physicsDebugData,
    lines: Array.from(vertices),
  } satisfies WW.MsgFromWorker);
}

export async function setupOrRebuildWorld(msg: WW.SetupPhysicsWorld) {
  const state = workerStore.getState();

  if (!state.world) {
    await RAPIER.init();
    state.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    state.world.timestep = 1 / state.fps; // in seconds
    state.eventQueue = new RAPIER.EventQueue(true);
  } else {
    state.world.forEachRigidBody((rigidBody) => state.world.removeRigidBody(rigidBody));
    state.world.forEachCollider((collider) => state.world.removeCollider(collider, false));
    state.bodyKeyToBody.clear();
    state.bodyKeyToCollider.clear();
    state.bodyHandleToKey.clear();
    // state.world.bodies.free();
    // state.world.colliders.free();
  }

  const assets = z.decode(AssetsSchema, msg.assets);
  const mapDef = assets.map[msg.mapKey]!;
  state.gms = mapDef.gms.map(({ gmKey, transform }, gmId) =>
    createLayoutInstance(assets.layout[gmKey]!, gmId, transform),
  );

  createDoorSensors();

  // 🚧
  // createGmColliders();

  // restoreNpcs(msg.npcs);

  // // fire initial collisions
  // stepWorld();
}
