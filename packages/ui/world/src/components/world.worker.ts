import { ExhaustiveError } from "@npc-cli/util/exhaustive-error";
import { debug } from "@npc-cli/util/legacy/generic";
import generateTiledNavMeshResult from "../worker/tiled-navmesh";

self.addEventListener("message", async (e: MessageEvent<WW.MsgToWorker>) => {
  const msg = e.data;
  debug("🤖 worker received", JSON.stringify(msg?.type));

  switch (msg.type) {
    case "ping":
      self.postMessage({ type: "pong" } satisfies WW.MsgFromWorker);
      break;

    case "request-tiled-navmesh": {
      const tiledNavMeshResult = await generateTiledNavMeshResult(msg.mapKey);
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
