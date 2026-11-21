import { hashText } from "@npc-cli/util/legacy/generic";
import type { PhysicsBijection } from "../worker/physics.store";

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

/** A fallen npc's rect sensor, for others to step over */
export function corpseColliderKey(npcKey: string) {
  return `corpse-${npcKey}`;
}

/** The corpse's npcKey a collider's key is for, else `null` */
export function corpseOf(colliderKey: string) {
  return colliderKey.startsWith("corpse-") ? colliderKey.slice("corpse-".length) : null;
}

export function npcToBodyKey(npcKey: string) {
  return `npc ${npcKey}` as const;
}

/**
 * Format:
 * - `['npc', npcKey]`
 * - `['circle', decorKey]`
 * - `['rect', decorKey]`
 * - `['nearby', gmDoorKey]`
 * - `['inside', gmDoorKey]`
 */
export function parsePhysicsBodyKey(bodyKey: WW.PhysicsBodyKey): WW.PhysicsParsedBodyKey {
  return bodyKey.split(" ") as WW.PhysicsParsedBodyKey;
}
