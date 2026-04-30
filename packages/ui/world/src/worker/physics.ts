import RAPIER, { ColliderDesc } from "@dimforge/rapier3d-compat";
import { workerStore } from "./worker.store";

const wallHeight: typeof import("../const")["wallHeight"] = 2;
const unitYAxis = { x: 0, y: 1, z: 0 } as const;

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

  return /** @type {RAPIER.RigidBody & { userData: WW.PhysicsUserData }} */ (rigidBody);
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
