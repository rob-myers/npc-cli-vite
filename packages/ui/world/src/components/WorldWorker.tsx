import { ExhaustiveError, useStateRef } from "@npc-cli/util";
import { debug } from "@npc-cli/util/legacy/generic";
import { useContext, useEffect } from "react";
import { WorldContext } from "./world-context";

export default function WorldWorker() {
  const w = useContext(WorldContext);

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
            w.nav = { ...msg };
            w.events.next({ key: "nav-updated" });
            w.update();
            break;
          }

          default:
            throw new ExhaustiveError(msg);
        }
      },

      ping() {
        state.worker.postMessage({ type: "ping" } satisfies WW.MsgToWorker);
      },
    }),
  );

  useEffect(() => {
    /**
     * 🔔 HMR can break if the webworker shares modules with main thread,
     * e.g. don't want full-page-reload on edit packages/ui/world/src/const.ts
     *
     * For this reason we send specially craft payloads to worker,
     * avoiding the need to e.g. parse or instantiate geomorphs.
     */
    const worker = new Worker(new URL("../worker/world.worker.ts", import.meta.url), { type: "module" });
    state.worker = worker;
    w.worker = state;
    worker.addEventListener("message", state.handleWorkerMessage);
    return () => {
      worker.removeEventListener("message", state.handleWorkerMessage);
      worker.terminate();
    };
  }, []); // setup worker

  return null;
}

export type State = {
  worker: Worker;
  handleWorkerMessage(e: MessageEvent<WW.MsgFromWorker>): void;
  ping(): void;
};
