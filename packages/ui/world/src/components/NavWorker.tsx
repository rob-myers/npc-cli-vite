import { useStateRef } from "@npc-cli/util";
import { debug } from "@npc-cli/util/legacy/generic";
import { useContext, useEffect } from "react";
import { ensureNavWorker } from "../service/nav-worker-factory";
import { getNavmeshPayload, getRaycastPayload, getRoomGraphPayload } from "../service/worker-data";
import { useWorkerLoadRetry } from "./use-worker-load-retry";
import { WorldContext } from "./world-context";

/** Owns the nav worker — the navmesh, the room graph and raycasts. Physics is `PhysicsWorker` */
export default function NavWorker() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      reloads: 0,
      worker: null as unknown as Worker,

      onWorkerMessage(e: MessageEvent<WW.MsgFromNavWorker>) {
        const msg = e.data;
        debug(`🤖 main thread received "${msg?.type}" from nav worker`);

        switch (msg.type) {
          case "pong":
            break;
          case "raycast-result": {
            w.e.pendingRaycast[msg.uid]?.resolve(msg);
            delete w.e.pendingRaycast[msg.uid];
            break;
          }
          case "unreachable-result": {
            w.e.pendingUnreachable[msg.uid]?.resolve(msg);
            delete w.e.pendingUnreachable[msg.uid];
            break;
          }
          case "tiled-navmesh-response": {
            w.nav = { ...msg };
            w.events.next({ key: "nav-updated" });
            w.setNextPending({ nav: false });
            break;
          }
          case "worker-hot-module-reload": {
            state.set({ reloads: state.reloads + 1 });
            break;
          }
          default:
            msg satisfies never; // another entry's, e.g. jsh's — see `nav-worker-factory`
        }
      },
    }),
  );

  useEffect(() => {
    if (!w.threeReady) return;

    // as `PhysicsWorker`: shares no module with the main thread, and is sent crafted payloads
    const worker = ensureNavWorker();
    state.worker = worker;
    w.navWorker = state;
    worker.addEventListener("message", state.onWorkerMessage);
    return () => {
      worker.removeEventListener("message", state.onWorkerMessage);
      worker.terminate();
      // whatever it was still being asked, it can no longer answer
      w.e.rejectPendingUnreachable(new Error("worker terminated"));
      w.e.rejectPendingRaycast(new Error("worker terminated"));
    };
  }, [w.threeReady, state.reloads]); // setup worker

  useWorkerLoadRetry(
    () => state.worker,
    () => state.set({ reloads: state.reloads + 1 }),
    [w.threeReady, state.reloads],
  );

  useEffect(() => {
    if (w.hash === 0) return;

    w.setNextPending({ nav: true });

    state.worker.postMessage({
      type: "request-tiled-navmesh",
      mapKey: w.mapKey,
      gmGeoms: getNavmeshPayload(w.gms),
      rayCast: getRaycastPayload(w.gms),
    } satisfies WW.MsgToNavWorker);

    state.worker.postMessage({
      type: "request-room-graph",
      mapKey: w.mapKey,
      roomGraph: getRoomGraphPayload(w.gmRoomGraph),
    } satisfies WW.MsgToNavWorker);
  }, [w.gmsHash, state.reloads]); // request navmesh, room graph

  return null;
}

export type State = {
  reloads: number;
  worker: Worker;
  onWorkerMessage(e: MessageEvent<WW.MsgFromNavWorker>): void;
};
