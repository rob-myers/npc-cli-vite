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
      inner: null as unknown as Worker,
      handleWorkerMessage(e: MessageEvent<WW.MsgFromWorker>) {
        const msg = e.data;
        debug(`🤖 main thread received "${msg?.type}" from worker`);

        switch (msg.type) {
          case "pong":
            break;

          case "tiled-navmesh-response": {
            // 🚧 extract triangles and draw in floor
            // 🚧 send event which can be awaited
            console.log(msg);
            state.loadTiledMesh(msg.tiledNavMeshResult);
            w.events.next({ key: "nav-updated" });
            break;
          }

          default:
            throw new ExhaustiveError(msg);
        }
      },
      loadTiledMesh(result: TiledNavMeshResult) {
        // 🚧
        w.nav.navMesh = result.navMesh;
        w.nav.intermediates = result.intermediates;
      },
      ping() {
        state.inner.postMessage({ type: "ping" } satisfies WW.MsgToWorker);
      },
    }),
  );

  useEffect(() => {
    const worker = new Worker(new URL("./world.worker.ts", import.meta.url), { type: "module" });
    state.inner = worker;
    w.worker = state;
    worker.addEventListener("message", state.handleWorkerMessage);
    return () => {
      worker.removeEventListener("message", state.handleWorkerMessage);
      worker.terminate();
      w.worker = null!;
    };
  }, []);

  return null;
}

export type State = {
  inner: Worker;
  handleWorkerMessage(e: MessageEvent<WW.MsgFromWorker>): void;
  loadTiledMesh(result: TiledNavMeshResult): void;
  ping(): void;
};
