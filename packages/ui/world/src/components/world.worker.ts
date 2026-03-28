import { ExhaustiveError } from "@npc-cli/util/exhaustive-error";
import { debug } from "@npc-cli/util/legacy/generic";
import generateTiledNavMeshResult from "../worker/tiled-navmesh";

self.addEventListener("message", async (e: MessageEvent<WW.MsgToWorker>) => {
  debug("🤖 worker received", JSON.stringify(e.data?.type));

  const msg = e.data;
  switch (msg.type) {
    case "ping":
      self.postMessage({ type: "pong" } satisfies WW.MsgFromWorker);
      break;

    case "request-tiled-navmesh": {
      const tiledNavMeshResult = await generateTiledNavMeshResult();
      self.postMessage({
        type: "tiled-navmesh-response",
        tiledNavMeshResult,
      } satisfies WW.MsgFromWorker);
      break;
    }

    default:
      throw new ExhaustiveError(msg);
  }
});
