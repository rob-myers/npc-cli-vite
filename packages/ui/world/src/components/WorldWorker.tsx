import { ExhaustiveError, useStateRef } from "@npc-cli/util";
import { debug } from "@npc-cli/util/legacy/generic";
import type { TiledNavMeshResult } from "navcat/blocks";
import { useContext, useEffect } from "react";
import { WorldContext } from "./world-context";

export default function WorldWorker() {
  const w = useContext(WorldContext);
  console.log(w);

  const state = useStateRef(
    (): State => ({
      worker: null as unknown as Worker,
      handleWorkerMessage(e: MessageEvent<WW.MsgFromWorker>) {
        const msg = e.data;
        debug(`🤖 main thread received "${msg?.type}" from worker`);

        switch (msg.type) {
          case "pong":
            break;

          case "tiled-navmesh-response": {
            state.loadTiledMesh(msg.tiledNavMeshResult);
            w.events.next({ key: "nav-updated" });
            break;
          }

          default:
            throw new ExhaustiveError(msg);
        }
      },
      loadTiledMesh(result: TiledNavMeshResult) {
        w.nav = { ...result };
        // 🚧
      },
      ping() {
        state.worker.postMessage({ type: "ping" } satisfies WW.MsgToWorker);
      },
    }),
  );

  useEffect(() => {
    const worker = new Worker(new URL("../worker/world.worker.ts", import.meta.url), { type: "module" });
    state.worker = worker;
    w.worker = state;
    worker.addEventListener("message", state.handleWorkerMessage);
    return () => {
      worker.removeEventListener("message", state.handleWorkerMessage);
      worker.terminate();
    };
  }, []); // setup worker

  useEffect(() => {
    if (!w.assets) return;

    state.worker.postMessage({
      type: "request-tiled-navmesh",
      mapKey: w.mapKey,
    } satisfies WW.MsgToWorker);
  }, [w.assets, w.mapKey]);

  return null;
}

export type State = {
  worker: Worker;
  handleWorkerMessage(e: MessageEvent<WW.MsgFromWorker>): void;
  loadTiledMesh(result: TiledNavMeshResult): void;
  ping(): void;
};
