import { ExhaustiveError } from "@npc-cli/util/exhaustive-error";
import { debug } from "@npc-cli/util/legacy/generic";
import { generateTiledNavMeshResult } from "./generate-tiled-navmesh";
import { navForFloorDraw } from "./nav-util";
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
      // await pause(1000);

      const tiledNavMeshResult = await generateTiledNavMeshResult(msg.gmGeoms);

      self.postMessage({
        type: "tiled-navmesh-response",
        ...tiledNavMeshResult,
        toNavTris: navForFloorDraw(msg.gmGeoms, tiledNavMeshResult.navMesh),
      } satisfies WW.MsgFromWorker);
      break;
    }
    case "setup-physics": {
      // 🚧
      break;
    }
    case "get-physics-debug-data": {
      // 🚧
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
