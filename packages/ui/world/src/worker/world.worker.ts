import RAPIER from "@dimforge/rapier3d-compat";
import { ExhaustiveError } from "@npc-cli/util/exhaustive-error";
import { debug, warn } from "@npc-cli/util/legacy/generic";
import { addBodyKeyUidRelation, npcToBodyKey } from "../service/physics-bijection";
import { generateTiledNavMeshResult } from "./generate-tiled-navmesh";
import { navForFloorDraw } from "./nav-util";
import { createRigidBody, sendPhysicsDebugData, setupOrRebuildWorld, stepWorld, wallHeight } from "./physics";
import { workerStore } from "./worker.store";

self.addEventListener("message", async (e: MessageEvent<WW.MsgToWorker>) => {
  const msg = e.data;
  if (msg?.type !== "send-npc-positions") {
    debug("🤖 worker received", JSON.stringify(msg?.type));
  }
  const state = workerStore.getState();

  switch (msg.type) {
    case "add-physics-colliders": {
      for (const { colliderKey, x, y: z, angle, userData, ...geomDef } of msg.colliders) {
        const bodyKey: WW.PhysicsBodyKey = `${geomDef.type} ${colliderKey}`;

        if (!(bodyKey in state.bodyKeyToBody)) {
          const _body = createRigidBody({
            type: RAPIER.RigidBodyType.Fixed,
            geomDef,
            // place static collider on floor with height `wallHeight`
            position: { x, y: wallHeight / 2, z },
            angle,
            userData: {
              ...(geomDef.type === "circle"
                ? { type: "cylinder", radius: geomDef.radius }
                : { type: "cuboid", width: geomDef.width, depth: geomDef.height, angle: angle ?? 0 }),
              bodyKey,
              bodyUid: addBodyKeyUidRelation(bodyKey, state),
              custom: userData,
            },
          });
        } else {
          warn(`🤖 physics.worker: ${msg.type}: cannot re-add body (${bodyKey})`);
        }
      }
      break;
    }
    case "add-physics-npcs": {
      for (const npc of msg.npcs) {
        const bodyKey = npcToBodyKey(npc.npcKey);
        if (bodyKey in state.bodyKeyToBody) {
          warn(`worker: ${msg.type}: cannot re-add body: ${bodyKey}`);
          continue;
        }

        const _body = createRigidBody({
          type: RAPIER.RigidBodyType.KinematicPositionBased,
          geomDef: {
            type: "circle",
            radius: state.agentRadius,
          },
          position: { x: npc.position.x, y: state.agentHeight / 2, z: npc.position.z },
          userData: {
            bodyKey,
            bodyUid: addBodyKeyUidRelation(bodyKey, state),
            type: "npc",
            radius: state.agentRadius,
          },
        });
      }
      break;
    }
    case "get-physics-debug-data": {
      sendPhysicsDebugData();
      break;
    }
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
    case "remove-physics-bodies":
    case "remove-physics-colliders": {
      const bodyKeys =
        msg.type === "remove-physics-bodies"
          ? msg.bodyKeys
          : msg.colliders.map((c) => `${c.type} ${c.colliderKey}` as const);
      for (const bodyKey of bodyKeys) {
        const body = state.bodyKeyToBody.get(bodyKey);
        if (body !== undefined) {
          state.bodyHandleToKey.delete(body.handle);
          state.bodyKeyToBody.delete(bodyKey);
          state.bodyKeyToCollider.delete(bodyKey);
          state.world.removeRigidBody(body);
        }
      }
      break;
    }
    case "send-npc-positions": {
      // set kinematic body positions
      let npcBodyKey = "" as WW.PhysicsBodyKey;
      const position = {} as { x: number; y: number; z: number };
      /**
       * decode: [npcBodyUid, positionX, positionY, positionZ, ...]
       */
      for (const [index, value] of msg.positions.entries()) {
        switch (index % 4) {
          case 0:
            npcBodyKey = state.bodyUidToKey[value];
            break;
          case 1:
            position.x = value;
            break;
          case 2:
            position.y = state.agentHeight / 2;
            break; // overwrite y
          case 3:
            position.z = value;
            (state.bodyKeyToBody.get(npcBodyKey) as RAPIER.RigidBody).setTranslation(position, true); // awaken on move
            break;
        }
      }
      stepWorld(state);
      break;
    }
    case "setup-physics": {
      await setupOrRebuildWorld(msg);
      console.log(msg);
      self.postMessage({ type: "world-setup-response" } satisfies WW.MsgFromWorker);
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
