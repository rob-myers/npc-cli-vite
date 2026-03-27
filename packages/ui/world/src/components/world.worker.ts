import { ExhaustiveError } from "@npc-cli/util/exhaustive-error";
import { debug } from "@npc-cli/util/legacy/generic";
import generateDemoNavMesh from "../worker/demo-tiled-navmesh";

self.addEventListener("message", async (e: MessageEvent<WW.MsgToWorker>) => {
  debug("🤖 worker received", JSON.stringify(e.data?.type));

  const msg = e.data;
  switch (msg.type) {
    case "ping":
      self.postMessage({ type: "pong" } satisfies WW.MsgFromWorker);
      break;
    case "test-generate-tiled-navmesh": {
      const generated = await generateDemoNavMesh();
      // JSON.stringify of navMesh is meaningful
      self.postMessage({
        type: "test-generate-tiled-navmesh-result",
        data: generated.navMesh,
      } satisfies WW.MsgFromWorker);
      break;
    }
    default:
      throw new ExhaustiveError(msg);
  }
});
