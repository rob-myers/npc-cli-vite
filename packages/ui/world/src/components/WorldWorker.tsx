import { MapEditSavedFileSchema } from "@npc-cli/ui__map-edit/editor.schema";
import { getLocalStorageDrafts } from "@npc-cli/ui__map-edit/map-node-api";
import { ExhaustiveError, useStateRef } from "@npc-cli/util";
import { debug } from "@npc-cli/util/legacy/generic";
import { useContext, useEffect } from "react";
import z from "zod";
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
      ...(import.meta.env.PROD && {
        mapEditDrafts: getLocalStorageDrafts().map((draft) => z.encode(MapEditSavedFileSchema, draft)),
      }),
    } satisfies WW.MsgToWorker);
  }, [w.assets, w.mapKey]);

  return null;
}

export type State = {
  worker: Worker;
  handleWorkerMessage(e: MessageEvent<WW.MsgFromWorker>): void;
  ping(): void;
};
