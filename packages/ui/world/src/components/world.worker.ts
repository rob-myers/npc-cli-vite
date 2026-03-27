import { debug } from "@npc-cli/util/legacy/generic";

self.addEventListener("message", (e: MessageEvent<WW.MsgToWorker>) => {
  debug("🤖 worker received", JSON.stringify(e.data?.type));

  if (e.data?.type === "ping") {
    self.postMessage({ type: "pong" } satisfies WW.MsgFromWorker);
  }
});
