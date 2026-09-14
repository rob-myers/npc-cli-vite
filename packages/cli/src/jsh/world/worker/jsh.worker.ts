import { onMessage as onNavMessage } from "@npc-cli/ui__world/worker/nav";
import { handleJshMessage } from "./handle-message";

/**
 * The nav worker, with jsh's own cases in front of it — see `register.ts`. Shares no main-thread
 * module with the world, else its HMR breaks — see `PhysicsWorker.tsx` there
 */
self.removeEventListener("message", onNavMessage);
self.addEventListener("message", (e: MessageEvent) => {
  if (handleJshMessage(e.data) === false) void onNavMessage(e);
});

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    self.postMessage({ type: "worker-hot-module-reload" });
  });
}
