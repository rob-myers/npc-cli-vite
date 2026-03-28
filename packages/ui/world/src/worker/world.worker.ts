import { ExhaustiveError } from "@npc-cli/util/exhaustive-error";
import { debug } from "@npc-cli/util/legacy/generic";
import { navForFloorDraw } from "./nav-util";
import generateTiledNavMeshResult, { computeMapGmInstances } from "./tiled-navmesh";

self.addEventListener("message", async (e: MessageEvent<WW.MsgToWorker>) => {
  const msg = e.data;
  debug("🤖 worker received", JSON.stringify(msg?.type));

  switch (msg.type) {
    case "ping":
      self.postMessage({ type: "pong" } satisfies WW.MsgFromWorker);
      break;

    case "request-tiled-navmesh": {
      const mapGmInstances = await computeMapGmInstances(msg.mapKey);

      const tiledNavMeshResult = await generateTiledNavMeshResult(mapGmInstances);
      self.postMessage({
        type: "tiled-navmesh-response",
        ...tiledNavMeshResult,
        toNavTris: navForFloorDraw(mapGmInstances, tiledNavMeshResult.navMesh),
      } satisfies WW.MsgFromWorker);
      break;
    }

    default:
      throw new ExhaustiveError(msg);
  }
});
