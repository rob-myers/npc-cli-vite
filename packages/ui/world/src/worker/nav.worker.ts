import { ExhaustiveError } from "@npc-cli/util/exhaustive-error";
import { debug, warn } from "@npc-cli/util/legacy/generic";
import type { NavMesh } from "navcat";
import { generateTiledNavMeshResult } from "./generate-tiled-navmesh";
import { navForFloorDraw } from "./nav-util";
import { createGmRayCastSystems, sendRaycastResult } from "./ray-cast";
import { findUnreachableResult, setRoomGraph } from "./room-graph";

/** The navmesh, once generated — for queries here, e.g. jsh's ops */
let navMesh: null | NavMesh = null;

export function getNavMesh() {
  return navMesh;
}

/**
 * The nav worker: the navmesh, the room graph and raycasts — everything geometric, apart from the
 * physics in `physics.worker.ts`. Exported so another entry can wrap it — see `jsh.worker.ts` in
 * `@npc-cli/cli`
 */
export const onMessage = async (e: MessageEvent<WW.MsgToNavWorker>) => {
  const msg = e.data;
  debug("🤖 nav worker received", JSON.stringify(msg?.type));

  switch (msg.type) {
    case "ping":
      self.postMessage({ type: "pong" } satisfies WW.MsgFromNavWorker);
      break;
    case "request-room-graph": {
      setRoomGraph(msg);
      break;
    }
    case "request-unreachable": {
      let blocked: WW.UnreachableResult["blocked"] = null;
      try {
        blocked = findUnreachableResult(msg);
      } catch (e) {
        // answering "reachable" leaves the npc walking up to the door and stopping, where an
        // unanswered query would leave `w.npc.move` waiting for a promise nothing can resolve
        warn("🤖 nav worker: request-unreachable failed", e);
      }
      self.postMessage({ type: "unreachable-result", uid: msg.uid, blocked } satisfies WW.MsgFromNavWorker);
      break;
    }
    case "request-tiled-navmesh": {
      createGmRayCastSystems(msg.rayCast, msg.gmGeoms);
      const tiledNavMeshResult = await generateTiledNavMeshResult(msg.gmGeoms);
      navMesh = tiledNavMeshResult.navMesh;
      self.postMessage({
        type: "tiled-navmesh-response",
        ...tiledNavMeshResult,
        toNavTris: navForFloorDraw(msg.gmGeoms, tiledNavMeshResult.navMesh),
      } satisfies WW.MsgFromNavWorker);
      break;
    }
    case "get-raycast": {
      sendRaycastResult(msg);
      break;
    }
    default:
      throw new ExhaustiveError(msg);
  }
};

self.addEventListener("message", onMessage);

if (import.meta.hot) {
  import.meta.hot.accept((_newModule) => {
    debug("Handling nav worker hot-module-reload...");
    self.postMessage({ type: "worker-hot-module-reload" } satisfies WW.MsgFromNavWorker);
  });
}
