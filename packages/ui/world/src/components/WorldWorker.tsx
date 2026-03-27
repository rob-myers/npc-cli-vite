import { ExhaustiveError, useStateRef } from "@npc-cli/util";
import { debug } from "@npc-cli/util/legacy/generic";
import { useContext, useEffect } from "react";
import { WorldContext } from "./world-context";

export default function WorldWorker() {
  const w = useContext(WorldContext);
  console.log(w);

  const state = useStateRef(
    (): State => ({
      inner: null as unknown as Worker,
      handleWorkerMessage(e: MessageEvent<WW.MsgFromWorker>) {
        debug(`main thread received "${e.data?.type}" from 🤖 worker`);

        const msg = e.data;
        switch (msg.type) {
          case "pong":
            break;
          case "test-generate-tiled-navmesh-result": {
            console.log(msg);
            break;
          }
          default:
            throw new ExhaustiveError(msg);
        }
      },
      ping() {
        state.inner.postMessage({ type: "ping" } satisfies WW.MsgToWorker);
      },
      testGenerateTiledNavMesh() {
        state.inner.postMessage({ type: "test-generate-tiled-navmesh" } satisfies WW.MsgToWorker);
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
  ping(): void;
  testGenerateTiledNavMesh(): void;
};
