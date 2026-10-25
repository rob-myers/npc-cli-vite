import { onMessage as onNavMessage } from "@npc-cli/ui__world/worker/nav";
import { runOp, setupPlan } from "./handle-message";
import { answerPerception, setDoorSeenThrough, setupPerception } from "./handle-perception";

/**
 * The nav worker, with jsh's own cases in front of it: plan ops and perception — see `register.ts`.
 * Shares no main-thread module with the world, else its HMR breaks — see `PhysicsWorker.tsx` there
 */
self.removeEventListener("message", onNavMessage);
self.addEventListener("message", (e: MessageEvent<WW.JshMsgToNavWorker | WW.PerceptionMsgTo>) => {
  const msg = e.data;
  switch (msg?.type) {
    case "jsh-setup":
      setupPlan(msg);
      setupPerception(msg);
      break;
    case "jsh-plan":
      void runOp(msg);
      break;
    case "perception-door":
      setDoorSeenThrough(msg);
      break;
    case "perception-query":
      void answerPerception(msg);
      break;
    default:
      void onNavMessage(e as MessageEvent);
  }
});

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    self.postMessage({ type: "worker-hot-module-reload", keepNavMesh: true } satisfies WW.MsgFromNavWorker);
  });
}
