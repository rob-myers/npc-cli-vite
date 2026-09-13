import { onMessage as onWorldMessage } from "@npc-cli/ui__world/worker";
import { handleJshMessage } from "./handle-message";

/**
 * The world worker, with jsh's own cases in front of it — see `register.ts`. Shares no main-thread
 * module with the world, else its HMR breaks — see `WorldWorker.tsx` there
 */
self.removeEventListener("message", onWorldMessage);
self.addEventListener("message", (e: MessageEvent) => {
  if (handleJshMessage(e.data) === false) void onWorldMessage(e);
});

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    self.postMessage({ type: "worker-hot-module-reload" });
  });
}
