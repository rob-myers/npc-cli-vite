import { useStateRef } from "@npc-cli/util";
import { debug } from "@npc-cli/util/legacy/generic";
import { useContext, useEffect } from "react";
import { ensureNavWorker } from "../service/nav-worker-factory";
import { getNavmeshPayload, getRaycastPayload, getRoomGraphPayload } from "../service/worker-data";
import { useWorkerLoadRetry } from "./use-worker-load-retry";
import { WorldContext } from "./world-context";

/**
 * Owns the nav worker, two copies of one bundle: `bulk` makes the navmesh and runs long ops, `fast` answers rays and
 * quick queries — see `docs/workers.md`. Physics is `PhysicsWorker`
 */
export default function NavWorker() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      navFor: 0,
      pending: new Map(),
      regenNavMesh: false,
      reloads: 0,
      workers: null,

      onWorkerMessage(e: MessageEvent<WW.MsgFromNavWorker>) {
        const msg = e.data;
        debug(`🤖 main thread received "${msg?.type}" from nav worker`);

        switch (msg.type) {
          case "pong":
            break;
          case "unreachable-result": {
            w.e.pendingUnreachable[msg.uid]?.resolve(msg);
            delete w.e.pendingUnreachable[msg.uid];
            break;
          }
          case "tiled-navmesh-response": {
            w.nav = { ...msg };
            state.post({ type: "set-navmesh", navMesh: msg.navMesh } satisfies WW.MsgToNavWorker, "fast");
            w.events.next({ key: "nav-updated" });
            w.setNextPending({ nav: false });
            break;
          }
          case "worker-hot-module-reload": {
            if (e.currentTarget !== state.workers?.bulk) break; // both run the same code: one respawns the pair
            if (msg.keepNavMesh !== true) state.regenNavMesh = true;
            state.set({ reloads: state.reloads + 1 });
            break;
          }
          default:
            msg satisfies never;
            state.settle(e.data as unknown as WW.NavWorkerReply); // another entry's, e.g. jsh's — see `nav-worker-factory`
        }
      },

      post(msg, role, transfer = []) {
        if (state.workers === null) return;
        if (role !== undefined) return state.workers[role].postMessage(msg, transfer);
        for (const worker of Object.values(state.workers)) worker.postMessage(msg);
      },

      request(msg, signal, role) {
        return new Promise((resolve, reject) => {
          signal.throwIfAborted();
          if (state.workers === null) throw Error("nav worker not ready");
          state.pending.set(msg.uid, { resolve, reject });
          signal.addEventListener("abort", () => (state.pending.delete(msg.uid), reject(signal.reason)), {
            once: true,
          });
          state.workers[role].postMessage(msg);
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
    const workers = { bulk: ensureNavWorker(), fast: ensureNavWorker() };
    state.workers = workers;
    w.navWorker = state;
    for (const worker of Object.values(workers)) worker.addEventListener("message", state.onWorkerMessage);
    return () => {
      for (const worker of Object.values(workers)) {
        worker.removeEventListener("message", state.onWorkerMessage);
        worker.terminate();
      }
      // whatever they were still being asked, they can no longer answer
      w.e.rejectPendingUnreachable(new Error("worker terminated"));
      for (const { reject } of state.pending.values()) reject(Error("worker terminated"));
      state.pending.clear();
    };
  }, [w.threeReady, state.reloads]); // setup workers

  const respawn = () => ((state.regenNavMesh = true), state.set({ reloads: state.reloads + 1 }));
  useWorkerLoadRetry(() => state.workers?.bulk ?? null, respawn, [w.threeReady, state.reloads]);
  useWorkerLoadRetry(() => state.workers?.fast ?? null, respawn, [w.threeReady, state.reloads]);

  useEffect(() => {
    if (w.hash === 0) return;

    const gmGeoms = getNavmeshPayload(w.gms);
    const rayCast = getRaycastPayload(w.gms);
    state.post({ type: "set-raycast-statics", gmGeoms, rayCast } satisfies WW.MsgToNavWorker, "fast");
    if (state.regenNavMesh === false && state.navFor === w.gmsHash && w.nav.gmsHash === w.gmsHash) {
      // respawned for jsh's code alone: the navmesh made last still holds
      state.post({ type: "set-navmesh", navMesh: w.nav.navMesh } satisfies WW.MsgToNavWorker);
    } else {
      w.setNextPending({ nav: true });
      state.post(
        { type: "request-tiled-navmesh", mapKey: w.mapKey, gmsHash: w.gmsHash, gmGeoms } satisfies WW.MsgToNavWorker,
        "bulk",
      );
    }
    state.navFor = w.gmsHash;
    state.regenNavMesh = false;

    state.post({
      type: "request-room-graph",
      mapKey: w.mapKey,
      roomGraph: getRoomGraphPayload(w.gmRoomGraph),
    } satisfies WW.MsgToNavWorker);
    // fresh workers have none
    w.door?.sendToRaycast();
    w.shields?.sendToRaycast();
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
  /** `null` until mounted */
  workers: null | Record<WW.NavRole, Worker>;
  onWorkerMessage(e: MessageEvent<WW.MsgFromNavWorker>): void;
  /** Posts `msg` to the copy `role`, else to both. Only one copy can take `transfer` */
  post<M extends { type: string }>(msg: M, role?: WW.NavRole, transfer?: Transferable[]): void;
  /** Posts `msg` to the copy `role`, resolving with its reply's `output`, else rejecting with its `error` */
  request(msg: WW.NavWorkerRequest, signal: AbortSignal, role: WW.NavRole): Promise<unknown>;
  settle(reply: WW.NavWorkerReply): void;
};
