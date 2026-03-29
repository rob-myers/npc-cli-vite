import type { WithImmer } from "@npc-cli/ui-sdk/with-immer-type.d.ts";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

/**
 * 🚧 unclear if we actually need to remember nav-generating payload
 */
export const workerStore: UseBoundStore<WithImmer<StoreApi<WorkerStoreState>>> = create<WorkerStoreState>()(
  immer(
    devtools(
      (_set, _get): WorkerStoreState => ({
        gmGeoms: [],
      }),
      { name: "worker.store", anonymousActionType: "worker.store" },
    ),
  ),
);

export type WorkerStoreState = {
  gmGeoms: WW.GmGeomForNav[];
};
