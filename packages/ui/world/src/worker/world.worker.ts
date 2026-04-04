import { ExhaustiveError } from "@npc-cli/util/exhaustive-error";
import { debug } from "@npc-cli/util/legacy/generic";
import { navForFloorDraw } from "./nav-util";
import { generateTiledNavMeshResult } from "./tiled-navmesh";
import { workerStore } from "./worker.store";

self.addEventListener("message", async (e: MessageEvent<WW.MsgToWorker>) => {
  const msg = e.data;
  debug("🤖 worker received", JSON.stringify(msg?.type));

  switch (msg.type) {
    case "ping":
      self.postMessage({ type: "pong" } satisfies WW.MsgFromWorker);
      break;

    case "request-tiled-navmesh": {
      // remember last payload
      workerStore.setState({ gmGeoms: msg.gmGeoms });

      const tiledNavMeshResult = await generateTiledNavMeshResult(msg.gmGeoms);

      self.postMessage({
        type: "tiled-navmesh-response",
        ...tiledNavMeshResult,
        toNavTris: navForFloorDraw(msg.gmGeoms, tiledNavMeshResult.navMesh),
      } satisfies WW.MsgFromWorker);
      break;
    }

    default:
      throw new ExhaustiveError(msg);
  }
});

if (import.meta.hot) {
  import.meta.hot.accept((_newModule) => {
    debug("Handling worker hot-module-reload...");
    self.postMessage({ type: "worker-hot-module-reload" } satisfies WW.MsgFromWorker);
  });
}
