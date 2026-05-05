import { ExhaustiveError, useStateRef } from "@npc-cli/util";
import { debug, warn } from "@npc-cli/util/legacy/generic";
import { useContext, useEffect } from "react";
import z from "zod";
import { AssetsSchema } from "../assets.schema";
import { helper } from "../service/helper";
import { parsePhysicsBodyKey } from "../service/physics-bijection";
import { WorldContext } from "./world-context";

export default function WorldWorker() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      physicsRebuilds: 0,
      reloads: 0,
      worker: null as unknown as Worker,

      handlePhysicsCollision(npcKey, otherKey, isEnter) {
        const [type, subKey] = parsePhysicsBodyKey(otherKey);

        if (type !== "npc") {
          w.events.next({
            key: isEnter === true ? "enter-collider" : "exit-collider",
            npcKey,
            ...(type === "nearby" || type === "inside"
              ? { type, ...helper.getGmDoorId(subKey) }
              : { type, decorKey: subKey }),
          });
        } else {
          warn(`${"handlePhysicsCollision"}: unexpected otherKey: "${otherKey}"`);
        }
      },
      onWorkerMessage(e: MessageEvent<WW.MsgFromWorker>) {
        const msg = e.data;
        debug(`🤖 main thread received "${msg?.type}" from worker`);

        switch (msg.type) {
          case "npc-collisions": {
            msg.collisionEnd.forEach(({ npcKey, otherKey }) => {
              if (otherKey === undefined) {
                warn(`${npcKey}: ${"handlePhysicsWorkerMessage"} collider removed whilst colliding`);
                return;
              }
              state.handlePhysicsCollision(npcKey, otherKey, false);
            });
            msg.collisionStart.forEach(({ npcKey, otherKey }) => {
              state.handlePhysicsCollision(npcKey, otherKey, true);
            });
            break;
          }
          case "physics-debug-data-response": {
            debug("physics debug data:", msg);
            break;
          }
          case "pong":
            break;

          case "tiled-navmesh-response": {
            w.nav = { ...msg };
            w.events.next({ key: "nav-updated" });
            w.setNextPending({ nav: false, decor: true });
            break;
          }
          case "worker-hot-module-reload": {
            state.set({ reloads: state.reloads + 1 });
            break;
          }
          case "world-setup-response": {
            state.physicsRebuilds++;
            break;
          }
          default:
            throw new ExhaustiveError(msg);
        }
      },
      ping() {
        state.worker.postMessage({ type: "ping" } satisfies WW.MsgToWorker);
      },
    }),
  );

  useEffect(() => {
    if (!w.threeReady) return;

    /**
     * 🔔 HMR can break if the webworker shares modules with main thread,
     * e.g. don't want full-page-reload on edit packages/ui/world/src/const.ts
     *
     * - we send specially craft payloads to worker
     * - this avoids e.g. parse or instantiate geomorphs.
     */
    const worker = new Worker(new URL("../worker/world.worker.ts", import.meta.url), { type: "module" });
    state.worker = worker;
    w.worker = state;
    worker.addEventListener("message", state.onWorkerMessage);
    return () => {
      worker.removeEventListener("message", state.onWorkerMessage);
      worker.terminate();
    };
  }, [w.threeReady, state.reloads]); // setup worker

  useEffect(() => {
    if (w.hash === 0) return;

    w.setNextPending({ nav: true });

    state.worker.postMessage({
      type: "request-tiled-navmesh",
      mapKey: w.mapKey,
      // - tailored data avoids worker dependency on "main thread modules"
      // - in PROD we send assets mutations too
      gmGeoms: w.gms.map<WW.GmGeomForNav>(
        ({ key, doors, bounds, determinant, gridRect, matrix, inverseMatrix, mat4, navDecomp }, gmId) => ({
          key,
          doorways: doors.map((connector, doorId) => ({
            gmId,
            doorId,
            // 🔔 geomorph instance polygons are untransformed
            polygon: connector.poly.clone().applyMatrix(matrix).geoJson,
          })),
          triangulation: navDecomp, // implicit Vect -> {x, y}
          worldBounds: bounds.clone().applyMatrix(matrix),
          determinant,
          gridRect: gridRect.json,
          inverseMat3: inverseMatrix.json,
          mat4Array: mat4.toArray(),
        }),
      ),
    } satisfies WW.MsgToWorker);

    state.worker.postMessage({
      type: "setup-physics",
      mapKey: w.mapKey, // On HMR must provide existing npcs:
      npcs: Object.values(w.npc?.npc ?? {}).map((npc) => ({
        npcKey: npc.key,
        position: npc.position,
      })),
      assets: z.encode(AssetsSchema, w.assets),
    } satisfies WW.MsgToWorker);

    w.events.next({ key: "requested-physics" });
  }, [w.gms, state.reloads]); // request navmesh, physics

  return null;
}

export type State = {
  physicsRebuilds: number;
  reloads: number;
  worker: Worker;
  handlePhysicsCollision(npcKey: string, otherKey: WW.PhysicsBodyKey, isEnter?: boolean): void;
  onWorkerMessage(e: MessageEvent<WW.MsgFromWorker>): void;
  ping(): void;
};
