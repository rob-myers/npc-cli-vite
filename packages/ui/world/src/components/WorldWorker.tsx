import { useStateRef } from "@npc-cli/util";
import { debug } from "@npc-cli/util/legacy/generic";
import { useContext, useEffect } from "react";
import { WorldContext } from "./world-context";

export default function WorldWorker() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      inner: null as unknown as Worker,
      handleWorkerMessage(e: MessageEvent<WW.MsgFromWorker>) {
        debug(`main thread received "${e.data?.type}" from 🤖 worker`);
        if (e.data?.type === "pong") {
          state.pongResolve?.("pong");
          state.pongResolve = null;
        }
      },
      ping() {
        return new Promise<"pong">((resolve) => {
          state.pongResolve = resolve;
          state.inner.postMessage({ type: "ping" } satisfies WW.MsgToWorker);
        });
      },
      pongResolve: null,
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
  ping(): Promise<"pong">;
  pongResolve: ((value: "pong") => void) | null;
};
