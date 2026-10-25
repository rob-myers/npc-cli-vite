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
      navFor: 0,
      pending: new Map(),
      regenNavMesh: false,
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
            if (msg.keepNavMesh !== true) state.regenNavMesh = true;
            state.set({ reloads: state.reloads + 1 });
            break;
          }
          default:
            msg satisfies never;
            state.settle(e.data as unknown as WW.NavWorkerReply); // another entry's, e.g. jsh's — see `nav-worker-factory`
        }
      },

      request(msg, signal) {
        return new Promise((resolve, reject) => {
          signal.throwIfAborted();
          state.pending.set(msg.uid, { resolve, reject });
          signal.addEventListener("abort", () => (state.pending.delete(msg.uid), reject(signal.reason)), {
            once: true,
          });
          state.worker.postMessage(msg);
        });
      },

      settle({ uid, output, error }) {
        const pending = state.pending.get(uid);
        if (pending === undefined) return;
        state.pending.delete(uid);
        error === undefined ? pending.resolve(output) : pending.reject(Error(error));
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
      for (const { reject } of state.pending.values()) reject(Error("worker terminated"));
      state.pending.clear();
    };
  }, [w.threeReady, state.reloads]); // setup worker

  useWorkerLoadRetry(
    () => state.worker,
    () => ((state.regenNavMesh = true), state.set({ reloads: state.reloads + 1 })),
    [w.threeReady, state.reloads],
  );

  useEffect(() => {
    if (w.hash === 0) return;

    const [gmGeoms, rayCast] = [getNavmeshPayload(w.gms), getRaycastPayload(w.gms)];
    if (state.regenNavMesh === false && state.navFor === w.gmsHash && w.nav.gmsHash === w.gmsHash) {
      // respawned for jsh's code alone: the navmesh it made last still holds
      state.worker.postMessage({
        type: "set-navmesh",
        navMesh: w.nav.navMesh,
        gmGeoms,
        rayCast,
      } satisfies WW.MsgToNavWorker);
    } else {
      w.setNextPending({ nav: true });
      state.worker.postMessage({
        type: "request-tiled-navmesh",
        mapKey: w.mapKey,
        gmsHash: w.gmsHash,
        gmGeoms,
        rayCast,
      } satisfies WW.MsgToNavWorker);
    }
    state.navFor = w.gmsHash;
    state.regenNavMesh = false;

    state.worker.postMessage({
      type: "request-room-graph",
      mapKey: w.mapKey,
      roomGraph: getRoomGraphPayload(w.gmRoomGraph),
    } satisfies WW.MsgToNavWorker);
    w.shields?.sendToRaycast(); // a fresh worker has none
  }, [w.gmsHash, state.reloads]); // request navmesh, room graph

  return null;
}

export type State = {
  /** The layout the navmesh was last asked for */
  navFor: number;
  /** By uid, another entry's requests awaiting a reply */
  pending: Map<string, { resolve(output: unknown): void; reject(e: Error): void }>;
  /** A respawn must make the navmesh afresh: its code changed, or it failed to load */
  regenNavMesh: boolean;
  reloads: number;
  worker: Worker;
  onWorkerMessage(e: MessageEvent<WW.MsgFromNavWorker>): void;
  /** Posts `msg`, resolving with its reply's `output`, else rejecting with its `error` */
  request(msg: WW.NavWorkerRequest, signal: AbortSignal): Promise<unknown>;
  settle(reply: WW.NavWorkerReply): void;
};
