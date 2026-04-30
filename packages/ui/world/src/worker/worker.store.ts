import type RAPIER from "@dimforge/rapier3d-compat";
import type { WithImmer } from "@npc-cli/ui-sdk/with-immer-type.d.ts";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

export const workerStore: UseBoundStore<WithImmer<StoreApi<WorkerStoreState>>> = create<WorkerStoreState>()(
  immer(
    devtools(
      (_set, _get): WorkerStoreState => ({
        gmGeoms: [],

        world: undefined as any,
        gms: /** @type {Geomorph.LayoutInstance[]} */ ([]),
        eventQueue: undefined as any,
        bodyHandleToKey: new Map(),
        bodyKeyToBody: new Map(),
        bodyKeyToCollider: new Map(),
        bodyKeyToUid: {},
        bodyUidToKey: {},
      }),
      { name: "worker.store", anonymousActionType: "worker.store" },
    ),
  ),
);

export type WorkerStoreState = { gmGeoms: WW.GmGeomForNav[] } & PhysicsState & PhysicsBijection;

interface PhysicsState {
  world: RAPIER.World;
  gms: Geomorph.LayoutInstance[];
  eventQueue: RAPIER.EventQueue;
  bodyHandleToKey: Map<number, WW.PhysicsBodyKey>;
  bodyKeyToCollider: Map<WW.PhysicsBodyKey, RAPIER.Collider>;
  bodyKeyToBody: Map<WW.PhysicsBodyKey, RAPIER.RigidBody>;
  // gmRayCast: { [gmKey in StarShipGeomorphKey]: System };
}

interface PhysicsBijection {
  bodyKeyToUid: { [bodyKey: WW.PhysicsBodyKey]: number };
  bodyUidToKey: { [bodyUid: number]: WW.PhysicsBodyKey };
}
