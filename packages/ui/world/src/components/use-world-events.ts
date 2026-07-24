import { ExhaustiveError, type UseStateRef, useStateRef } from "@npc-cli/util";
import { geomService } from "@npc-cli/util/geom-service";
import { pause, warn } from "@npc-cli/util/legacy/generic";
import { crowd as crowdApi } from "navcat/blocks";
import { useEffect } from "react";
import shortUuid from "short-uuid";
import { defaultDoorCloseMs, defaultSkinKey, MAX_NPCS, nearbyDoorMergeDist } from "../const";
import type { AStarSearchResult } from "../pathfinding/AStar";
import { helper } from "../service/helper";
import { npcToBodyKey } from "../service/physics-bijection";
import type { Npc } from "./npc";
import type { State as WorldState } from "./World";

export default function useWorldEvents(w: UseStateRef<WorldState>) {
  const state = useStateRef(
    (): State => ({
      doableToNpc: {},
      doorOpen: {},
      doorToNpcs: {},
      externalNpcs: new Set(),
      npcToAccess: {},
      npcToDoable: {},
      npcToDoors: {},
      npcToRoom: new Map(),
      pendingRaycast: {},
      roomToNpcs: [],

      addFrameCallback(cb) {
        return w.r3f.internal.subscribe({ current: cb }, 0, w.r3fStore);
      },
      canCloseDoor(door) {
        const closeNpcs = state.doorToNpcs[door.gdKey];
        if (closeNpcs === undefined) {
          return true;
        } else if (closeNpcs.inside.size > 0) {
          return [...closeNpcs.inside].some((npcKey) => {
            const distance = geomService.getPerpendicularDistanceSeg(door.src, door.dst, w.n[npcKey].point);
            // console.log({ distance });
            return distance > 0.2; // npc(s) using doorway
          });
        } else if (closeNpcs.nearby.size === 0) {
          return true;
        } else if (door.auto === true && door.locked === false) {
          return false; // nope: npc(s) trigger sensor
        }
        return true;
      },
      checkNpcTargetUnreachable(npc) {
        const grId = state.npcToRoom.get(npc.key) ?? null;
        const dstGrId = npc.last.dstGrId;

        if (grId === null || dstGrId === null || grId.grKey === dstGrId.grKey) {
          return null; // not moving or same room
        }

        const npcResult = state.findPath(grId.grKey, dstGrId.grKey, { npcKey: npc.key });
        if (npcResult.success) {
          return null;
        }

        // when astar fails find a good prefix
        const unblockedResult = state.findPath(grId.grKey, dstGrId.grKey);
        const firstBadDoor = unblockedResult.path.find(
          (node): node is Graph.GmRoomGraphNodeDoor =>
            node.type === "door" && state.npcCanAccess(npc.key, node.gdKey) === false,
        );

        return firstBadDoor ?? null;
      },
      findGmIdContaining(input) {
        if (typeof input.meta?.gmId === "number" && input.meta.gmId >= 0) {
          return input.meta.gmId;
        }
        return w.gmGraph.findGmIdContaining(helper.parseGroundPoint(input));
      },
      findPath(srcGrKey, dstGrKey, { npcKey } = {}) {
        return w.gmRoomGraph.findPath(srcGrKey, dstGrKey, {
          setWeights: npcKey
            ? (nodes) => {
                for (const node of nodes) {
                  if (node.type === "door") {
                    node.astar.closed = !state.npcCanAccess(npcKey, node.gdKey);
                  }
                }
              }
            : undefined,
        });
      },
      findRoomContaining(input, includeDoors = false) {
        if (helper.isGmRoomId(input.meta) === true) {
          // existing input.meta overrides includeDoors `false`
          // return { ...input.meta };
          return { gmId: input.meta.gmId, roomId: input.meta.roomId, grKey: input.meta.grKey };
        }
        const gmId = state.findGmIdContaining(input);
        if (typeof gmId === "number") {
          const point = helper.parseGroundPoint(input);
          const gm = w.gms[gmId];
          const localPoint = gm.inverseMatrix.transformPoint({ x: point.x, y: point.y });
          const roomId = w.gmsData.findRoomIdContaining(gm, localPoint, includeDoors);
          return roomId === null ? null : { gmId, roomId, grKey: helper.getGmRoomKey(gmId, roomId) };
        } else {
          return null;
        }
      },
      fixInaccessibleTarget(npc) {
        // avoid walking to other-side-of-wall of inaccessible room
        const blockingDoorNode = state.checkNpcTargetUnreachable(npc);
        if (blockingDoorNode === null || npc.agentId == null) {
          return;
        }

        // walk along prefix
        const result = w.npc.getClosestPoly(blockingDoorNode.astar.centroid); // center?
        crowdApi.requestMoveTarget(
          w.npc.crowd,
          npc.agentId,
          result.nodeRef,
          helper.groundPointToTuple(blockingDoorNode.astar.centroid),
        );
      },
      getPoint(npcKey) {
        const npc = w.npc.get(npcKey);
        return {
          x: npc.position.x,
          y: npc.position.z,
          meta: { npcKey, ...state.npcToRoom.get(npcKey) },
        };
      },
      npcCanAccess(npcKey, gdKey) {
        const door = w.d[gdKey];
        if (door.locked === false) {
          return true;
        }
        if (door.open === true && state.doorToNpcs[door.gdKey].nearby.has(npcKey)) {
          return true;
        }
        // only if npc has been granted access
        return !!state.npcToAccess[npcKey]?.[door.gdKey];
      },
      onEvent(e) {
        if ("npcKey" in e) {
          return state.onNpcEvent(e);
        }
        switch (e.key) {
          case "door-open":
            state.doorOpen[e.gdKey] = true;
            break;
          case "door-opening": {
            const door = w.d[e.gdKey];
            if (door.hull === true) {
              const adj = w.gmGraph.getAdjacentRoomCtxt(door.gmId, door.doorId);
              adj !== null && w.e.toggleDoor(adj.adjGdKey, { open: true, access: true });
            }
            break;
          }
          case "door-closed":
            state.doorOpen[e.gdKey] = false;
            break;
          case "door-closing": {
            const door = w.d[e.gdKey];
            if (door.hull === true) {
              const adj = w.gmGraph.getAdjacentRoomCtxt(door.gmId, door.doorId);
              adj !== null && w.e.toggleDoor(adj.adjGdKey, { open: false, access: true });
            }
            break;
          }
          case "picked": {
            const { lastPointer, roomLightEditingEnabled, controls } = w.view;
            if (roomLightEditingEnabled === true && lastPointer.longPress === true && controls.pointers.length <= 1) {
              w.view.toggleRoomLit(helper.parseGroundPoint(e));
            }
            break;
          }
          case "removed-npcs": {
            for (const npcKey of e.npcKeys) {
              const gmRoomId = state.npcToRoom.get(npcKey);
              if (gmRoomId !== undefined) {
                state.npcToRoom.delete(npcKey);
                state.roomToNpcs[gmRoomId.gmId][gmRoomId.roomId].delete(npcKey);
              } else {
                state.externalNpcs.delete(npcKey);
              }
            }

            w.bubble.delete(...e.npcKeys);

            const { trackedNpcKey } = w.view.light;
            if (trackedNpcKey !== null && e.npcKeys.includes(trackedNpcKey)) {
              w.npc.trackNpc();
            }

            break;
          }
          case "requested-physics": {
            state.recomputeNpcRoomRelationships();
            break;
          }
          case "try-close-door": {
            state.tryCloseDoor(e.gdKey);
            break;
          }
          case "disabled":
          case "door-locked":
          case "door-unlocked":
          case "enabled":
          case "enter-topdown":
          case "exit-topdown":
          case "nav-updated":
          case "spawned-many":
            break;
          default:
            throw new ExhaustiveError(e);
        }
      },
      onEnterCollider(e, npc) {
        if (e.type === "nearby" || e.type === "inside") {
          state.toggleDoor(e.meta.gdKey, {
            open: true,
            npcKey: e.npcKey,
            // don't toggle accessible locked door unless npc intends entry
            npcIntention: npc.getCornersPath() ?? undefined,
          });
        }
      },
      onExitCollider(e, npc) {
        if (e.type === "inside") {
          const door = w.door.byKey[e.meta.gdKey];
          if (door.locked === true && door.auto === true) {
            state.tryCloseDoor(e.meta.gdKey);
          }

          const gmRoomId = state.npcToRoom.get(npc.key);
          const nextGmRoomId = state.findRoomContaining(npc.position, true);
          if (gmRoomId === undefined || nextGmRoomId === null) {
            return;
          }
          if (nextGmRoomId.grKey === gmRoomId.grKey) {
            // entered collider then turned around and exited
            return;
          }

          // trigger enter-room on exit inside-collider and changed room
          w.events.next({ key: "enter-room", npcKey: npc.key, gmRoomId: nextGmRoomId });
        }

        if (e.type === "nearby") {
          // try close door under conditions
          const door = w.door.byKey[e.meta.gdKey];
          if (door.open === true) {
            if (door.auto === true && state.doorToNpcs[e.meta.gdKey]?.nearby.size === 0) {
              state.tryCloseDoor(e.meta.gdKey);
            }
          } else if (door.locked === true) {
            state.tryCloseDoor(e.meta.gdKey);
          } else if (door.auto === true && state.doorToNpcs[e.meta.gdKey]?.nearby.size === 0) {
            // if auto and none nearby, try close
            state.tryCloseDoor(e.meta.gdKey);
          }
        }
      },
      onNpcEvent(e) {
        const npc = w.npc.npc[e.npcKey];
        switch (e.key) {
          case "enter-collider": {
            if (e.type === "nearby") {
              (state.doorToNpcs[e.meta.gdKey] ??= { inside: new Set(), nearby: new Set() }).nearby.add(npc.key);
              (state.npcToDoors[e.npcKey] ??= { inside: null, nearby: new Set() }).nearby.add(e.meta.gdKey);
            }
            if (e.type === "inside") {
              (state.doorToNpcs[e.meta.gdKey] ??= { inside: new Set(), nearby: new Set() }).inside.add(npc.key);
              (state.npcToDoors[e.npcKey] ??= { inside: null, nearby: new Set() }).inside = e.meta.gdKey;
            }

            state.onEnterCollider(e, npc);
            break;
          }
          case "enter-room": {
            const gmRoomId = state.npcToRoom.get(npc.key);
            if (gmRoomId) {
              state.roomToNpcs[gmRoomId.gmId][gmRoomId.roomId].delete(npc.key);
            } else {
              state.externalNpcs.delete(npc.key);
            }
            state.npcToRoom.set(npc.key, e.gmRoomId);
            (state.roomToNpcs[e.gmRoomId.gmId][e.gmRoomId.roomId] ??= new Set()).add(npc.key);

            break;
          }
          case "exit-collider": {
            if (e.type === "nearby") {
              state.doorToNpcs[e.meta.gdKey].nearby?.delete(npc.key);
              state.npcToDoors[e.npcKey].nearby?.delete(e.meta.gdKey);
            }
            if (e.type === "inside") {
              state.doorToNpcs[e.meta.gdKey].inside?.delete(npc.key);
              state.npcToDoors[e.npcKey].inside = null;
            }

            state.onExitCollider(e, npc);
            break;
          }
          case "spawned": {
            if (npc.spawns === 1) {
              const { x, y, z } = npc.position;
              w.worker.worker.postMessage({
                type: "add-physics-npcs",
                npcs: [{ npcKey: e.npcKey, position: { x, y, z } }],
              } satisfies WW.MsgToWorker);
            } else {
              // respawn
              const prevGrId = state.npcToRoom.get(npc.key);
              if (prevGrId !== undefined) {
                state.roomToNpcs[prevGrId.gmId][prevGrId.roomId]?.delete(npc.key);
              }
              if (w.view.light.trackedNpcKey === npc.key) {
                state.switchTrackedNpcRoom(e.gmRoomId);
              }
            }

            state.npcToRoom.set(npc.key, { ...e.gmRoomId });
            (state.roomToNpcs[e.gmRoomId.gmId][e.gmRoomId.roomId] ??= new Set()).add(e.npcKey);

            break;
          }
          case "started-moving": {
            state.fixInaccessibleTarget(npc);

            const nearbyGdKeys = state.npcToDoors[e.npcKey]?.nearby ?? emptySet;
            const npcIntention = nearbyGdKeys.size > 0 ? npc.getCornersPath() : null;
            for (const gdKey of nearbyGdKeys) {
              state.toggleDoor(gdKey, {
                open: true,
                npcKey: e.npcKey,
                // don't toggle accessible locked door unless npc intends entry
                npcIntention: npcIntention ?? undefined,
              });
            }
            break;
          }
        }
      },
      async raycast(origSrc, origDst) {
        let src = helper.parseGroundPoint(origSrc);
        const dst = helper.parseGroundPoint(origDst);

        // Both points must reside in a room or doorway
        const srcGrId = state.findRoomContaining(src, true);
        const dstGrId = state.findRoomContaining(dst, true);
        if (srcGrId === null) {
          throw Error(`${"raycast"}: src must be in a room/doorway ${JSON.stringify({ x: src.x, y: src.y })}`);
        } else if (dstGrId === null) {
          throw Error(`${"raycast"}: dst must be in a room/doorway ${JSON.stringify({ x: dst.x, y: dst.y })}`);
        }

        if (Math.abs(src.x - dst.x) < 0.01 && Math.abs(src.y - dst.y) < 0.01) {
          // avoid 'detect-collisions' throw on zero-length rays
          return { success: true, hit: null, gmDoorIds: [], rooms: [srcGrId.grKey], doors: [], hitDoor: null };
        }

        const [grIds, gdIds] = [[] as Geomorph.GmRoomId[], [] as Geomorph.GmDoorId[]];
        let gmId = srcGrId.gmId;
        let roomId = srcGrId.roomId;
        let hit: null | Geom.VectJson = null;
        let hitDoor: null | Geomorph.GmDoorKey = null;

        const raycastUid = shortUuid.generate();
        let maxAdjGeomorphs = 2; // 🔔 detect ray between at most 2 geomorphs

        while (maxAdjGeomorphs-- > 0) {
          grIds.push(helper.getGmRoomId(gmId, roomId));

          w.worker.worker.postMessage({
            type: "get-raycast",
            uid: raycastUid,
            src,
            dst,
            gmId,
          } satisfies WW.MsgToWorker);

          const result = await new Promise<WW.RaycastResultResponse>(
            (resolve, reject) => (state.pendingRaycast[raycastUid] = { resolve, reject }),
          );

          hit = result.hit;
          // check whether ray is blocked by a door panel (accounting for partial open)
          for (const gdId of result.gmDoorIds) {
            const door = w.d[gdId.gdKey];
            const blockResult = w.door.checkRayDoorBlock(src, dst, gdId.gdKey);
            if (blockResult.blocked) {
              // `null` if ray intersects door rect but not door seg (ends inside doorway)
              if (blockResult.hit !== null) hit = blockResult.hit;
              if (hit !== null) hitDoor = gdId.gdKey;
              break;
            }
            // ray passes through gap
            gdIds.push(gdId);
            const otherRoomId = door.connector.roomIds.find((x) => x !== roomId) ?? null;
            otherRoomId !== null && grIds.push(helper.getGmRoomId(gmId, otherRoomId));
          }

          const lastGdId = gdIds[gdIds.length - 1];

          if (
            hit !== null || // hit something
            lastGdId === undefined || // no doors touched
            w.d[lastGdId.gdKey].hull === false // last open door NOT a hull door
          ) {
            break;
          }

          // check open hull door intersect
          hit = w.door.computeRayDoorIntersect(src, dst, lastGdId.gdKey);
          const adjCtxt = w.gmGraph.getAdjacentRoomCtxt(gmId, lastGdId.doorId);

          if (
            hit === null || // dst in hull doorway (distinct gmId since hull doorways overlap)
            adjCtxt === null // should be unreachable: sealed hull door always closed
          ) {
            break;
          }

          // next, start from hull door intersection
          src = hit;
          hit = null;
          gmId = adjCtxt.adjGmId;
          roomId = adjCtxt.adjRoomId;
        }

        return {
          success: hit === null,
          hit: hit === null ? null : geomService.precision2d(hit, 2),
          hitDoor,
          doors: gdIds.map(({ gdKey }) => gdKey),
          rooms: grIds.map(({ grKey }) => grKey),
        };
      },
      async recomputeNpcRoomRelationships() {
        const prevRoomToNpcs = state.roomToNpcs;
        const prevExternalNpcs = state.externalNpcs;
        state.roomToNpcs = w.gms.map((_, _gmId) => []);
        state.externalNpcs = new Set();

        for (const [_gmId, byRoom] of prevRoomToNpcs.entries()) {
          // We'll recompute every npc previously in this gmId
          const npcs = Object.values(byRoom).flatMap((npcKeys) =>
            Array.from(npcKeys).map((npcKey) => w.npc.npc[npcKey]),
          );

          for (const [i, npc] of npcs.entries()) {
            if (i > 0 && i % 5 === 0) await pause(); // batching?
            state.tryPutNpcIntoRoom(npc);
          }
        }

        // try fix previous external npcs
        for (const npcKey of prevExternalNpcs) {
          const npc = w.npc.npc[npcKey];
          state.tryPutNpcIntoRoom(npc);
        }
      },
      removeAgents(npcs, { keepPhysics = false } = {}) {
        for (const npc of npcs) {
          if (npc.agentId === null) continue;
          crowdApi.removeAgent(w.npc.crowd, npc.agentId);
          delete w.npc.byAgentId[npc.agentId];
          npc.agentId = null;
        }

        if (keepPhysics === true) return;

        // physics worker will fire exit colliders
        w.worker.worker.postMessage({
          type: "remove-physics-bodies",
          bodyKeys: npcs.map((npc) => npcToBodyKey(npc.key)),
        } satisfies WW.MsgToWorker);
      },
      removeNpcs(...npcKeys) {
        const npcs = npcKeys.flatMap((npcKey) => w.n[npcKey] ?? []);

        state.removeAgents(npcs);

        for (const npc of npcs) {
          npc.anim.mixer.stopAllAction();
          npc.material.dispose();
          npc.geometry.dispose();
          delete w.npc.byPickId[npc.pickId];
          delete w.n[npc.key];
          w.e.setNpcDo(npc.key, null);
          npc.rejectAll(new Error("removed npc"));
        }

        if (Object.keys(w.n).length === 0) {
          w.npc.nextPickId = 0;
        }

        w.shadows?.onTick();
        w.rings?.onTick();
        w.npc.update();
        w.events.next({ key: "removed-npcs", npcKeys });
      },
      setNpcDo(npcKey, decorKey) {
        const currentDecorKey = w.e.npcToDoable[npcKey];
        if (typeof currentDecorKey === "string") {
          w.e.doableToNpc[currentDecorKey] = null;
        }
        if (typeof decorKey === "string") {
          w.e.doableToNpc[decorKey] = npcKey;
        }
        w.e.npcToDoable[npcKey] = decorKey;
      },
      async spawnMany(opts) {
        const baseKey = opts.baseKey ?? "npc";
        const numPermitted = MAX_NPCS - (state.npcToRoom.size + state.externalNpcs.size);
        const groundPoints = opts.ats.slice(0, numPermitted).map(helper.parseGroundPoint);
        const npcKeys = groundPoints.map((_, i) => opts.keys?.[i] ?? `${baseKey}-${i}`);

        /** Ground point should either be doable or navigable */
        const doResults = groundPoints.map((p, i) => w.npc.findFreeDoMeta(p.meta ?? emptyMeta, npcKeys[i]));

        const angles = doResults.map((doResult, i) => {
          const angleOrPoint = opts.looks?.[i];
          return w.npc.determineSpawnedAngle({
            groundPoint: groundPoints[i],
            meta: doResult?.meta ?? emptyMeta,
            angle: typeof angleOrPoint === "number" ? angleOrPoint : undefined,
            facing: helper.isPointAnyFormat(angleOrPoint) ? angleOrPoint : undefined,
            npc: w.n[npcKeys[i]],
          });
        });

        const npcs: Npc[] = [];
        for (const [i, npcKey] of npcKeys.entries()) {
          const doResult = doResults[i];
          const groundPoint = doResult?.meta.groundPoint ?? groundPoints[i];
          npcs.push(
            w.npc.rawSpawn({
              npcKey,
              groundPoint,
              doResult,
              as: opts.skins?.[i] ?? defaultSkinKey,
              angle: angles[i],
            }),
          );
        }

        w.shadows?.onTick(); // ensure shadow visible even when paused
        w.rings?.onTick();
        w.view.forceUpdate();

        await Promise.all(
          npcs.map(
            (npc) =>
              npc.spawns++ === 0 &&
              new Promise((resolve, reject) => ((npc.resolve.spawn = resolve), (npc.reject.spawn = reject))),
          ),
        );

        w.events.next({ key: "spawned-many" });
      },
      checkTrackedDoorCrossing() {
        const npcKey = w.view.light.trackedNpcKey;
        if (npcKey === null) {
          return;
        }

        const gdKey = state.npcToDoors[npcKey]?.inside ?? null;
        if (gdKey === null) {
          w.view.light.doorCrossGdKey = null;
          w.view.light.doorCrossSign = null;
          return;
        }

        const door = w.d[gdKey];
        const npc = w.npc.npc[npcKey];
        const dp = (npc.position.x - door.src.x) * door.normal.x + (npc.position.z - door.src.y) * door.normal.y;
        const sign: 0 | 1 = dp > 0 ? 0 : 1;

        if (w.view.light.doorCrossGdKey !== gdKey) {
          // just entered this door's sensor zone — establish baseline, don't switch yet
          w.view.light.doorCrossGdKey = gdKey;
          w.view.light.doorCrossSign = sign;
          return;
        }

        if (sign !== w.view.light.doorCrossSign) {
          w.view.light.doorCrossSign = sign;
          const roomId = door.connector.roomIds[sign];
          const gmRoomId =
            roomId !== null
              ? helper.getGmRoomId(door.gmId, roomId)
              : w.gmGraph.getOtherGmRoomId(door, door.connector.roomIds[1 - sign] as number);
          if (gmRoomId !== null) {
            state.switchTrackedNpcRoom(gmRoomId);
          }
        }
      },
      switchTrackedNpcRoom(gmRoomId) {
        // instant refresh — no pop to hide (unlike the old room-polygon-only clip, the door-list
        // swap has no visible discontinuity of its own, since reaching an adjacent room now
        // depends on a live ray-through-door test, not a baked-in polygon shape)
        const prevGmRoomId = w.view.light.currentGmRoomId;
        w.view.light.currentGmRoomId = gmRoomId;

        let outline = w.view.computeRoomOutline(gmRoomId);
        const doors = w.view.computeRoomDoors(gmRoomId);

        // a door from the room just left, close enough to the npc, is still merged in — else it
        // can go dark instantly (e.g. it meets the just-crossed door at a right angle, so reaching
        // its own far room now needs two door-hops, which the tracked light doesn't support)
        const npcKey = w.view.light.trackedNpcKey;
        const npc = npcKey === null ? null : w.npc.npc[npcKey];
        const extraDoors =
          npc !== null && prevGmRoomId !== null && prevGmRoomId.grKey !== gmRoomId.grKey
            ? w.view
                .computeRoomDoors(prevGmRoomId)
                .filter((d) => !doors.some((newDoor) => newDoor.instanceId === d.instanceId))
                .filter((d) => {
                  const midX = (d.a.x + d.b.x) / 2;
                  const midZ = (d.a.z + d.b.z) / 2;
                  return Math.hypot(npc.position.x - midX, npc.position.z - midZ) < nearbyDoorMergeDist;
                })
            : [];

        if (npc !== null && extraDoors.length > 0) {
          outline = w.view.extendRoomOutlineNearDoors(
            outline,
            extraDoors.map((d) => w.door.fromInstanceId[d.instanceId].gdKey),
            { x: npc.position.x, y: npc.position.z },
          );
        }

        const allDoors = [...doors, ...extraDoors];
        w.view.trackedLight.setTrackedRoomOutline(outline);
        w.view.trackedLight.setTrackedRoomDoors(allDoors);
        w.view.light.doorInstanceIds = allDoors.map((d) => d.instanceId);

        // parallel raycast-light system — bake this gm instance's walls once (no-op if already
        // baked), mark it as the currently-active one for sampling, and register ALL of its doors
        // (not just room-bordering ones — Phase B occludes per gm instance, not per room)
        const gm = w.gms[gmRoomId.gmId];
        const layout = w.assets.layout[gm.key];
        if (layout) {
          w.view.dynamicLight.setGmWalls(gm.key, layout.walls, layout.bounds);
          w.view.dynamicLight.setActiveGm(gm.key, gm.matrix);
          const activeGmDoors = layout.doors.map((connector, doorId) => {
            const doorState = w.d[`g${gmRoomId.gmId}d${doorId}` as Geomorph.GmDoorKey];
            return { seg: connector.seg, gapAtHighLambda: doorState.gapAtHighLambda, instanceId: doorState.instanceId };
          });
          w.view.dynamicLight.setActiveGmDoors(activeGmDoors);
          w.view.light.activeGmDoorInstanceIds = activeGmDoors.map((d) => d.instanceId);
        }
      },
      toggleDoor(gdKey, opts = {}) {
        const door = w.door.byKey[gdKey];

        // clear if already closed and no npc colliding with "inside" collider
        opts.clear ??= door.open === false || !(state.doorToNpcs[gdKey]?.nearby.size > 0);

        const path = opts.npcIntention ?? [];
        const intersects = path.some(
          (p, i) => i > 0 && geomService.getLineSegsIntersection(p, path[i - 1], door.src, door.dst) !== null,
        );

        opts.access ??=
          opts.npcKey === undefined ||
          (door.auto === true && door.locked === false) ||
          (state.npcCanAccess(opts.npcKey, gdKey) && (path.length === 0 || intersects === true));

        return w.door.toggleDoor(door, opts);
      },
      toggleLock(gdKey, opts = {}) {
        const door = w.door.byKey[gdKey];

        if (opts.point === undefined || opts.npcKey === undefined) {
          // e.g. game master i.e. no npc
          return w.door.toggleLock(door, opts);
        }

        const { position: npcPoint } = w.npc.npc[opts.npcKey];
        if (npcPoint.distanceTo(helper.groundPointToVector3(helper.parseGroundPoint(opts.point))) > 1.5) {
          return false; // e.g. button not close enough
        }

        opts.access ??= state.npcCanAccess(opts.npcKey, gdKey);

        return w.door.toggleLock(door, opts);
      },
      tryCloseDoor(gdKey) {
        const door = w.door.byKey[gdKey];
        w.door.cancelClose(door);
        door.closeTimeoutId = window.setTimeout(() => {
          if (w.disabled === true) {
            // do not close whilst paused; recheck in {ms}
            state.tryCloseDoor(gdKey);
          } else if (door.open === true) {
            const clear = state.canCloseDoor(door);
            state.toggleDoor(gdKey, { clear, close: true });
          } else {
            // closed
            delete door.closeTimeoutId;
          }
        }, defaultDoorCloseMs);
      },
      tryPutNpcIntoRoom(npc) {
        const grId = state.findRoomContaining(npc.position, true);
        if (grId !== null) {
          state.npcToRoom.set(npc.key, grId);
          state.externalNpcs.delete(npc.key);
          (state.roomToNpcs[grId.gmId][grId.roomId] ??= new Set()).add(npc.key);
        } else {
          // Erase stale info and warn
          state.npcToRoom.delete(npc.key);
          state.externalNpcs.add(npc.key);
          warn(`${npc.key}: no longer inside any room`);
        }
      },
    }),
  );

  w.e = state;

  useEffect(() => {
    // 🔔 internal because it can synchronously invoke `w.events.next`
    const sub = w.events.subscribe({ next: state.onEvent }, { internal: true });
    return () => {
      sub.unsubscribe();
    };
  }, []);
}

export type State = {
  doableToNpc: { [decorKey: string]: string | null };
  doorOpen: { [gmDoorKey: Geomorph.GmDoorKey]: boolean | undefined };
  doorToNpcs: { [gmDoorKey: Geomorph.GmDoorKey]: { nearby: Set<string>; inside: Set<string> } };
  externalNpcs: Set<string>;
  npcToAccess: { [npcKey: string]: { [gdKey: string]: boolean } };
  npcToDoable: { [npcKey: string]: string | null };
  npcToDoors: { [npcKey: string]: { inside: null | Geomorph.GmDoorKey; nearby: Set<Geomorph.GmDoorKey> } };
  /**
   * Relates `npcKey` to current room.
   */
  npcToRoom: Map<string, Geomorph.GmRoomId>;
  pendingRaycast: { [uid: string]: { resolve(result: WW.RaycastResultResponse): void; reject(): void } };
  /**
   * The "inverse" of npcToRoom i.e. `roomToNpc[gmId][roomId]` is a set of `npcKey`s
   */
  roomToNpcs: { [roomId: number]: Set<string> }[];

  addFrameCallback(cb: () => void): () => void;
  canCloseDoor(door: Geomorph.DoorState): boolean;
  /**
   * - When an npc is moving its destination should be inside a room.
   * - When the npc is in a room adjacent to the destination room,
   *   and the room is inaccessible (e.g. locked doors) we want to avoid
   *   the crowd system redirecting the npc to the "other side of the wall".
   */
  checkNpcTargetUnreachable(npc: Npc): null | Graph.GmRoomGraphNodeDoor;
  /**
   * Precisely detects the tracked npc crossing a door's own dividing line — while it occupies
   * that door's "inside" sensor zone (see `npcToDoors`) — and calls `switchTrackedNpcRoom`
   * immediately, in either direction (including a mid-doorway reversal). Called every tick from
   * `WorldView`'s `updateLight`.
   */
  checkTrackedDoorCrossing(): void;
  findPath(
    srcGrKey: Geomorph.GmRoomKey,
    dstGrKey: Geomorph.GmRoomKey,
    opts?: { npcKey?: string; srcCentroid?: Geom.VectJson },
  ): AStarSearchResult<Graph.GmRoomGraphNode>;
  findGmIdContaining(input: MaybeMeta<JshCli.PointAnyFormat>): number | null;
  findRoomContaining(point: MaybeMeta<JshCli.PointAnyFormat>, includeDoors?: boolean): null | Geomorph.GmRoomId;
  fixInaccessibleTarget(npc: Npc): void;
  getPoint(npcKey: string): Meta<JshCli.GroundPoint>;
  npcCanAccess(npcKey: string, gdKey: Geomorph.GmDoorKey): boolean;
  onEvent(e: JshCli.Event): void;
  onEnterCollider(e: JshCli.EnterColliderEvent, npc: Npc): void;
  onExitCollider(e: JshCli.ExitColliderEvent, npc: Npc): void;
  onNpcEvent(e: Extract<JshCli.Event, { npcKey: string }>): void;
  recomputeNpcRoomRelationships(): void;
  raycast(src: MaybeMeta<JshCli.PointAnyFormat>, dst: MaybeMeta<JshCli.PointAnyFormat>): Promise<JshCli.RaycastResult>;
  removeAgents(npcs: Npc[], opts?: { keepPhysics?: boolean }): void;
  removeNpcs(...npcKeys: string[]): void;
  setNpcDo(npcKey: string, decorKey: string | null): void;
  spawnMany(opts: JshCli.SpawnManyOpts): Promise<void>;
  switchTrackedNpcRoom(nextRoomOrDoor: Geomorph.GmRoomId): void;
  toggleDoor(
    gdKey: Geomorph.GmDoorKey,
    opts?: {
      npcKey?: string;
      /**
       * Given `npcIntention` then locked accessible doors will only
       * be opened if npc's intended path intersects the door.
       *
       * Intuitively the NPC flashed their authentication to enter.
       */
      npcIntention?: JshCli.GroundPoint[];
    } & Geomorph.ToggleDoorOpts,
  ): boolean;
  toggleLock(
    gdKey: Geomorph.GmDoorKey,
    opts: { npcKey?: string; point?: JshCli.PointAnyFormat } & Geomorph.ToggleLockOpts,
  ): boolean;
  tryCloseDoor(gdKey: Geomorph.GmDoorKey): void;
  tryPutNpcIntoRoom(npc: Npc): void;
};

const emptySet = new Set();
const emptyMeta = {};
