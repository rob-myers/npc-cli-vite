import { ExhaustiveError, type UseStateRef, useStateRef } from "@npc-cli/util";
import { geomService } from "@npc-cli/util/geom-service";
import { pause, warn } from "@npc-cli/util/legacy/generic";
import { crowd as crowdApi } from "navcat/blocks";
import { useEffect } from "react";
import shortUuid from "short-uuid";
import {
  defaultDoorCloseMs,
  defaultPlayerKey,
  defaultSkinKey,
  floorFadeDelayMs,
  introPanDelayMs,
  MAX_NPCS,
  mapVeilMs,
  npcConfig,
  unfoldDelayMs,
} from "../const";
import type { AStarSearchResult } from "../pathfinding/AStar";
import { helper } from "../service/helper";
import { npcToBodyKey } from "../service/physics-bijection";
import { alwaysShownSlot, slotOf } from "../service/room-slots";
import * as persisted from "../service/storage";
import { type Npc, rejectNoop } from "./npc";
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
      handLitRooms: new Set(),
      litRooms: new Map(),
      npcToRoom: new Map(),
      pendingRaycast: {},
      pendingUnreachable: {},
      roomToNpcs: [],

      addFrameCallback(cb) {
        return w.r3f.internal.subscribe({ current: cb }, 0, w.r3fStore);
      },
      canAutoCloseDoor(door) {
        const closeNpcs = state.doorToNpcs[door.gdKey];

        if (door.auto === false && door.locked === true) {
          // never auto-close manual locked doors
          return false;
        }

        if (closeNpcs === undefined || closeNpcs.nearby.size === 0) {
          // auto or unlocked manual doors auto-close when no nearby npcs
          return true;
        }

        if (door.proximity === true) {
          return false; // proximity door won't close until npc leaves
        }

        if (closeNpcs.inside.size > 0) {
          return false;
        }

        return [...closeNpcs.nearby].every((npcKey) => w.n[npcKey].isMoving() === false);
      },
      async testTargetUnreachable(npc, dstGrId = npc.last.dstGrId) {
        const grId = state.npcToRoom.get(npc.key) ?? null;

        if (grId === null || dstGrId === null || grId.grKey === dstGrId.grKey) {
          return null; // invalid or same room
        }

        const srcNode = w.gmRoomGraph.getNode(grId.grKey);
        const dstNode = w.gmRoomGraph.getNode(dstGrId.grKey);
        if (srcNode === null || dstNode === null) {
          return null;
        }

        // the graph work itself runs in the worker — see `worker/room-graph.ts`
        const blocked = await state.requestUnreachable(npc, srcNode.index, dstNode.index);
        if (blocked === null) {
          return null;
        }

        const doorNode = w.gmRoomGraph.nodesArray[blocked.doorIndex] as Graph.GmRoomGraphNodeDoor;
        const roomNode = w.gmRoomGraph.nodesArray[blocked.roomIndex] as Graph.GmRoomGraphNodeRoom;
        const door = w.d[doorNode.gdKey];
        const indexOfRoomId = door.connector.roomIds.indexOf(roomNode.roomId);

        if (indexOfRoomId === -1) {
          return { blockingGdKey: door.gdKey, nearbyPoint: doorNode.astar.centroid.clone() };
        }

        return {
          blockingGdKey: door.gdKey,
          nearbyPoint: doorNode.astar.centroid
            .clone()
            .addScaled(door.normal, shutDoorKeepOut * (indexOfRoomId === 0 ? 1 : -1)),
        };
      },
      async requestUnreachable(npc, srcIndex, dstIndex) {
        if (w.worker?.worker === undefined) {
          return null; // asked before the worker was up, e.g. a scripted move on bootstrap
        }

        // A flag per NODE, so the worker reads a door's state at the index it knows the door by.
        // Sent with the query rather than kept in step as doors lock and swing: they change far
        // more often than they are asked about, and this way there is nothing to go stale
        const nodes = w.gmRoomGraph.nodesArray;
        const locked = new Uint8Array(nodes.length);
        const open = new Uint8Array(nodes.length);
        for (const [index, node] of nodes.entries()) {
          if (node.type !== "door") continue;
          locked[index] = w.d[node.gdKey]?.locked === true ? 1 : 0;
          open[index] = w.d[node.gdKey]?.open === true ? 1 : 0;
        }

        const uid = shortUuid.generate();
        w.worker.worker.postMessage(
          {
            type: "request-unreachable",
            uid,
            srcIndex,
            dstIndex,
            // likewise: an npc holds few keys, and `grant` / `revoke` write straight to
            // `npcToAccess`, so nothing needs telling when they change
            accessDoorIndices: Object.entries(state.npcToAccess[npc.key] ?? {}).flatMap(([gdKey, granted]) =>
              granted === true ? (w.gmRoomGraph.getNode(gdKey as Geomorph.GmDoorKey)?.index ?? []) : [],
            ),
            locked,
            open,
          } satisfies WW.MsgToWorker,
          [locked.buffer, open.buffer],
        );

        let cancel = rejectNoop;
        try {
          const result = await new Promise<WW.UnreachableResult>((resolve, reject) => {
            state.pendingUnreachable[uid] = { resolve, reject };
            npc.reject.worker = cancel = reject;
          });
          return result.blocked;
        } finally {
          delete state.pendingUnreachable[uid];
          if (npc.reject.worker === cancel) {
            npc.reject.worker = rejectNoop;
          }
        }
      },
      findClearPointOnSeg(src, seg, doors) {
        const [ux, uy, vx, vy] = [seg.s[0], seg.s[2], seg.s[3], seg.s[5]];
        // Sampled rather than solved: a boundary segment is short, and this is a handful of lines
        const steps = Math.ceil(Math.hypot(vx - ux, vy - uy) / npcConfig.dist.agentRadius);
        let best = null as null | Geom.VectJson;
        let bestDst = Number.POSITIVE_INFINITY;

        for (let i = 0; i <= steps; i++) {
          const lambda = steps === 0 ? 0 : i / steps;
          const at = { x: ux + lambda * (vx - ux), y: uy + lambda * (vy - uy) };
          const dst = Math.hypot(at.x - src.x, at.y - src.y);
          if (dst < bestDst && doors.every((door) => w.door.blocksDoorway(at, door) === false)) {
            [best, bestDst] = [at, dst];
          }
        }

        return best;
      },
      findGmIdContaining(input) {
        if (typeof input.meta?.gmId === "number" && input.meta.gmId >= 0) {
          return input.meta.gmId;
        }
        return w.gmGraph.findGmIdContaining(helper.parseGroundPoint(input));
      },
      findPathAsync(srcGrKey, dstGrKey, opts) {
        return w.gmRoomGraph.findPathAsync(srcGrKey, dstGrKey, {
          setNodeWeights: opts?.setNodeWeights,
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
      getPoint(npcKey) {
        const npc = w.npc.get(npcKey);
        return {
          x: npc.position.x,
          y: npc.position.z,
          meta: { npcKey, ...state.npcToRoom.get(npcKey) },
        };
      },
      npcCanAccess(npcKey, gdKey, planning = true) {
        const door = w.d[gdKey];
        if (!door || door.locked === false) {
          return true; // absent onchange map
        }
        // An npc without access can slip through a locked door whilst it stands OPEN, but only
        // from right beside it. Asked whether they could get somewhere — rather than whether they
        // could step through from where they are standing — the proximity is beside the point:
        // they would walk up to it first, and satisfy it on arrival
        if (door.open === true && (planning === true || state.doorToNpcs[door.gdKey]?.nearby.has(npcKey))) {
          return true;
        }
        // only if npc has been granted access
        return !!state.npcToAccess[npcKey]?.[door.gdKey];
      },
      rejectPendingUnreachable(err) {
        for (const uid of Object.keys(state.pendingUnreachable)) {
          state.pendingUnreachable[uid].reject(err);
          delete state.pendingUnreachable[uid];
        }
      },
      async onBootstrapMap() {
        const { player } = w;
        const saved = persisted.getWorldMapStore(w.key, w.mapKey).read().npcs;

        const firstBootstrap = player.prevMapPosition === null;
        if (firstBootstrap) {
          player.key = saved?.playerKey ?? defaultPlayerKey;
          // The arrival is shown whole: folded (or flat, on a phone), then the fade comes on, then
          // the world rises. Left to itself the fade would arrive the moment the player spawns —
          // which is before any of that, and would hide all of it but the one room they are in
          w.view.setFadeRoomsActive("gm");
        }

        try {
          // the player goes first, else a restored npc would be adopted as them
          await player.ensure();
          await state.restoreNpcs(saved);
          // a restored npc can be standing in a doorway — every door starts closed, so one would
          // shut through them. Before the frame below, so it is never seen closed over them
          await state.openDoorwaysWithNpcs();
          // spawning resolves on mount, which is not the same as drawn — without a rendered
          // frame in hand the npcs pop in a beat after the world has been revealed empty
          w.view.forceUpdate(0.01);
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        } finally {
          if (firstBootstrap === true) {
            // the first map is on screen as a flat hull; hold it a beat, bring the fade on, then
            // unfold the world with a delayed floor fade-in
            await pause(unfoldDelayMs);
            w.view.setFadeRoomsActive(w.view.fadeRoomsMode);
            const rising = w.foldTo(1);
            await pause(floorFadeDelayMs);
            void w.floor?.fadeTo(1);
            await rising;
          } else {
            // a map change has been behind black since `fadeOut`, and simply comes back from it
            await w.view.veilCanvas(false, mapVeilMs);
          }
        }

        if (firstBootstrap === false) {
          // a map we asked for arrives on the player, wherever the last map left the camera
          await pause(introPanDelayMs);
          await player.panTo();
        } else {
          // on load the view is the one we restored, and is left alone: taking the camera off
          // whatever we were looking at is a poor greeting. Instead it is offered — see WorldView
          w.view.showCentreHint();
        }
      },
      async restoreFromWorld(fromWorldKey) {
        // cloned, else both worlds would share the arrays we just adopted
        const saved = structuredClone(persisted.getWorldMapStore(fromWorldKey, w.mapKey).read());
        // ours from now on, so a reload keeps it
        persisted.getWorldMapStore(w.key, w.mapKey).patch(saved);

        w.door.applyLocks(saved.doorLocks ?? []);
        w.view.setPostProcessingEnabled(true);

        state.removeNpcs(...Object.keys(w.n));
        w.player.key = saved.npcs?.playerKey ?? w.player.key;
        // the player goes first, else a restored npc would be adopted as them
        await w.player.ensure();
        await state.restoreNpcs(saved.npcs);
        await state.openDoorwaysWithNpcs();
        w.view.forceUpdate();
      },
      async resetWorldState() {
        w.door.resetLocks(); // back to the map's own `meta.locked`
        w.view.setPostProcessingEnabled(true);

        state.removeNpcs(...Object.keys(w.n));
        persisted.getWorldMapStore(w.key, w.mapKey).patch({ npcs: null });
        // nothing saved to restore now, so the player respawns near the camera
        await w.player.ensure();
        await state.openDoorwaysWithNpcs();
        state.persistNpcs();
        w.view.forceUpdate();
      },
      onChangeMap() {
        // whilst the outgoing map still exists
        state.persistNpcs();
        const player = w.n[w.player.key];
        w.player.prevMapPosition = player === undefined ? null : { ...player.point };

        state.removeNpcs(...Object.keys(w.n));

        state.doableToNpc = {};
        state.doorOpen = {};
        state.doorToNpcs = {};
        state.externalNpcs = new Set();
        state.npcToAccess = {};
        state.npcToDoable = {};
        state.npcToDoors = {};
        state.handLitRooms = new Set(); // a `grKey` means nothing to the map coming in
        state.litRooms = new Map(); // the map's own save carries these across, via `restoreNpcs`
        state.npcToRoom = new Map();
        state.roomToNpcs = [];

        // anything still waiting on the worker asked about the old map's rooms
        state.rejectPendingUnreachable(new Error("map changed"));

        // arm "map-settled" ahead of the world query
        w.setNextPending({ assets: true });
      },
      onChangeTheme() {
        const { obstacles, doors, post } = w.getTheme();
        w.obs.setBrightness(obstacles.brightness);
        w.door.setBrightness(doors.brightness);
        w.floor.setFadedTint(post.fadedFloorTint);
        w.obs.setFadedTint(post.fadedObstacleTint);
        w.view.postFx.lightBg.value.set(post.lightBg);
        w.view.postFx.darkBg.value.set(post.darkBg);
        // w.view.forceUpdate();
      },
      onEvent(e) {
        if ("npcKey" in e) {
          return state.onNpcEvent(e);
        }
        switch (e.key) {
          case "door-open":
            state.doorOpen[e.gdKey] = true;
            state.syncFadeRooms();
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
            state.syncFadeRooms();
            break;
          case "door-closing": {
            const door = w.d[e.gdKey];
            if (door.hull === true) {
              const adj = w.gmGraph.getAdjacentRoomCtxt(door.gmId, door.doorId);
              adj !== null && w.e.toggleDoor(adj.adjGdKey, { open: false, access: true });
            }
            break;
          }
          case "removed-npcs": {
            for (const npcKey of e.npcKeys) {
              const gmRoomId = state.npcToRoom.get(npcKey);
              if (gmRoomId !== undefined) {
                state.npcToRoom.delete(npcKey);
                state.roomToNpcs[gmRoomId.gmId]?.[gmRoomId.roomId]?.delete(npcKey);
              } else {
                state.externalNpcs.delete(npcKey);
              }
            }

            w.bubble.delete(...e.npcKeys);

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
          case "map-settled":
            void state.onBootstrapMap();
            break;
          case "door-unlocked":
            state.tryCloseDoor(e.gdKey);
            break;
          case "door-locked":
            break;
          case "disabled":
          case "enabled":
          case "nav-updated":
            // the crowd is empty at this point, which is what makes it safe to walk a spare agent
            w.npc?.warmCrowd();
            break;
          case "picked": {
            // a long press is how you get at an npc: they say "...", and the speech's own npcKey
            // is the handle onto everything else — see `WorldSpeech`
            if (e.longDown === true && e.meta.type === "npc" && typeof e.meta.npcKey === "string") {
              w.speech.say(e.meta.npcKey, "...");
            }
            break;
          }
          case "spawned-many": {
            // `spawnMany` goes via `rawSpawn`, which does not fire `spawned` — so this is where its
            // npcs are put into the rooms they stand in, as that would have done
            for (const npcKey of e.npcKeys) {
              if (w.n[npcKey] !== undefined) state.tryPutNpcIntoRoom(w.n[npcKey]);
            }
            state.syncFadeRooms();
            break;
          }
          case "update-faded-rooms":
            if (w.debug?.fadeRoomOutlines === true) w.floor.drawAll();
            break;
          default:
            throw new ExhaustiveError(e);
        }
      },
      onEnterCollider(e, npc) {
        const door = w.door.byKey[e.meta.gdKey];
        if (!door) return; // onchange map

        if (e.type === "nearby" || e.type === "inside") {
          state.toggleDoor(e.meta.gdKey, {
            open: true,
            npcKey: e.npcKey,
            npcIntention: npc.getCornersPath() ?? undefined,
          });
        }

        if (e.type === "inside") {
          const gmRoomId = state.npcToRoom.get(npc.key) as Geomorph.GmRoomId;
          const nextGmRoomId = w.gmGraph.getOtherGmRoomId(door, gmRoomId.roomId);
          nextGmRoomId !== null && w.events.next({ key: "enter-doorway", npcKey: npc.key, gmRoomId, nextGmRoomId });
        }
      },
      onExitCollider(e, npc) {
        const door = w.door.byKey[e.meta.gdKey];
        if (!door) {
          return; // onchange map
        }

        if (e.type === "inside") {
          state.tryCloseDoor(e.meta.gdKey);

          const gmRoomId = state.npcToRoom.get(npc.key);
          const nextGmRoomId = state.findRoomContaining(npc.position, true);
          if (gmRoomId === undefined || nextGmRoomId === null) {
            return;
          }

          w.events.next({
            key: "enter-room",
            npcKey: npc.key,
            gmRoomId: nextGmRoomId,
            reEntered: nextGmRoomId.grKey === gmRoomId.grKey,
          });
        }

        if (e.type === "nearby") {
          state.tryCloseDoor(e.meta.gdKey);
        }
      },
      onNpcEvent(e) {
        const npc = w.npc.npc[e.npcKey];
        if (npc === undefined) {
          return; // removing an npc fires its exit colliders afterwards
        }
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
            if (e.reEntered === false) {
              // changed room
              const gmRoomId = state.npcToRoom.get(npc.key);
              if (gmRoomId) {
                state.roomToNpcs[gmRoomId.gmId]?.[gmRoomId.roomId]?.delete(npc.key);
              } else {
                state.externalNpcs.delete(npc.key);
              }
              state.npcToRoom.set(npc.key, e.gmRoomId);
              if (state.roomToNpcs[e.gmRoomId.gmId]) {
                (state.roomToNpcs[e.gmRoomId.gmId][e.gmRoomId.roomId] ??= new Set()).add(npc.key);
              }
            }

            if (state.syncLitRoom(npc) === true) {
              state.syncFadeRooms();
            }

            break;
          }
          case "exit-collider": {
            if (e.type === "nearby") {
              state.doorToNpcs[e.meta.gdKey]?.nearby.delete(npc.key);
              state.npcToDoors[e.npcKey]?.nearby.delete(e.meta.gdKey);
            }
            if (e.type === "inside") {
              state.doorToNpcs[e.meta.gdKey]?.inside.delete(npc.key);
              if (state.npcToDoors[e.npcKey]) state.npcToDoors[e.npcKey].inside = null;
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
            }

            state.npcToRoom.set(npc.key, { ...e.gmRoomId });
            (state.roomToNpcs[e.gmRoomId.gmId][e.gmRoomId.roomId] ??= new Set()).add(e.npcKey);
            // a spawn is how an npc ARRIVES somewhere: `fadeSpawn` and teleports land here rather
            // than at `enter-room`, which only fires for one who walked there
            state.syncFadeRooms();

            break;
          }
          case "npc-hidden":
          case "npc-shown": {
            npc.hidden = e.hidden;
            // the whole group, so their label goes with them
            if (npc.group !== null) npc.group.visible = e.hidden === false;
            break;
          }
          case "started-moving": {
            const nearbyGdKeys = state.npcToDoors[e.npcKey]?.nearby ?? emptySet;
            const npcIntention = nearbyGdKeys.size > 0 ? npc.getCornersPath() : null;
            for (const gdKey of nearbyGdKeys) {
              state.toggleDoor(gdKey, {
                open: true,
                npcKey: e.npcKey,
                npcIntention: npcIntention ?? undefined,
              });
            }
            break;
          }
          case "enter-doorway":
            // a doorway belongs to two rooms, and a lit npc standing in one lights both
            if (state.syncLitRoom(npc, e.nextGmRoomId) === true) {
              state.syncFadeRooms();
            }
            break;
          case "speech":
            break;
          default:
            throw new ExhaustiveError(e);
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
      persistNpcs() {
        persisted.getWorldMapStore(w.key, w.mapKey).patch({
          npcs: {
            playerKey: w.n[w.player.key] === undefined ? null : w.player.key,
            npcs: Object.values(w.n).map((npc) => ({
              key: npc.key,
              at: { x: npc.point.x, y: npc.point.y },
              angle: npc.rotation.y,
              skinKey: w.npc.getSkinKeyBySkinIndex(npc.skinIndex) ?? defaultSkinKey,
              decorKey: state.npcToDoable[npc.key] ?? undefined,
              lit: npc.lit === true ? true : undefined,
            })),
          },
        });
      },
      async restoreNpcs(saved = persisted.getWorldMapStore(w.key, w.mapKey).read().npcs) {
        if (saved === null) {
          return;
        }

        for (const { key, at, angle, skinKey, decorKey, lit } of saved.npcs) {
          if (key === w.player.key || w.n[key] !== undefined) {
            continue;
          }
          try {
            // the decor meta re-establishes what they were doing e.g. sitting
            await w.npc.spawn({
              npcKey: key,
              at: { ...at, meta: decorKey ? w.decor.byKey[decorKey]?.meta : undefined },
              angle,
              as: skinKey,
            });
            const spawned = w.npc.npc[key];
            if (lit === true && spawned !== undefined) state.setNpcLit(spawned, true);
          } catch (e) {
            warn(`${key}: could not restore`, e); // e.g. no longer placable
          }
        }
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
          state.litRooms.delete(npc.key);
          npc.rejectAll(new Error("removed npc"));
        }

        w.shadows?.onTick();
        w.rings?.onTick();
        w.speech?.removeNpcToasts(...npcKeys);
        w.npc.update();
        // `update` only SCHEDULES the React commit that unmounts the mesh, and a PAUSED world
        // draws on demand — so nothing would draw the world without them, and it goes on showing
        // the npc in its bind pose (the mixer having been stopped). Ask once the commit is in, and
        // again after: one demand frame is not enough here, as spawning found too — see the two
        // `requestAnimationFrame`s in `restoreNpcs`
        requestAnimationFrame(() => {
          w.view.forceUpdate();
          requestAnimationFrame(() => w.view.forceUpdate());
        });
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

        w.events.next({ key: "spawned-many", npcKeys });
      },
      toggleDoor(gdKey, opts = {}) {
        const door = w.door.byKey[gdKey];
        if (!door) {
          warn(`${gdKey}: toggleDoor: no such door`); // e.g. onchange map, or a stale pick
          return false;
        }

        // clear if closed or no npc "inside" collider
        opts.clear ??= door.open === false || !(state.doorToNpcs[gdKey]?.inside.size > 0);

        // patched navcat to use 4 corners to ensure path intersects door
        // 🚧 maybe unnecessary now we use `door.innerSegs`
        const path = opts.npcIntention ?? [];

        const willIntersect = w.door.doesPathIntersectDoor(path, door);
        // console.log({ willIntersect, path });

        opts.access ??=
          opts.npcKey === undefined ||
          // non-auto should not open unless npc has access & will intersect
          (door.locked === false && !(door.auto === false && door.open === false)) ||
          (state.npcCanAccess(opts.npcKey, gdKey) && (path.length === 0 || willIntersect === true));

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
      async openDoorwaysWithNpcs() {
        await w.worker?.settle();
        for (const npcKey in w.n) {
          const gdKey = state.npcToDoors[npcKey]?.inside;
          if (gdKey === null || gdKey === undefined) continue;
          const door = w.d[gdKey];
          if (door === undefined || w.door.snapOpen(door) === false) continue;
          state.tryCloseDoor(gdKey);
        }
      },
      setRoomLit(input, next) {
        const { grKey, gmId, roomId } = typeof input === "string" ? helper.getGmRoomId(input) : input;
        if (w.gms[gmId]?.rooms[roomId] === undefined) {
          warn(`${grKey}: setRoomLit: no such room`); // e.g. onchange map, or a malformed key
          return;
        }
        // syncing where nothing changed costs nothing: every morph is already headed where it goes
        if (next ?? state.handLitRooms.has(grKey) === false) state.handLitRooms.add(grKey);
        else state.handLitRooms.delete(grKey);
        state.syncFadeRooms();
      },
      clearHandLitRooms() {
        state.handLitRooms.clear();
        state.syncFadeRooms();
      },
      setNpcLit(npc, next = npc.lit === false) {
        if (npc.key === w.player.key) {
          return;
        }
        npc.npcLit.value = next === true ? 1 : 0;
        if (state.syncLitRoom(npc) === true) {
          state.syncFadeRooms();
        }
      },
      syncLitRoom(npc, alsoAt) {
        if (npc.key === w.player.key) {
          return true; // player must sync
        }
        const at = npc.lit === true ? state.npcToRoom.get(npc.key) : undefined;
        if (at === undefined) {
          return state.litRooms.delete(npc.key);
        }
        state.litRooms.set(npc.key, alsoAt === undefined ? [at] : [at, alsoAt]);
        return true;
      },
      syncFadeRooms() {
        w.view.fadeRoomsFx.sync(w);
        state.syncNpcRoomSlots();
        w.view.forceUpdate();
        w.events.next({ key: "update-faded-rooms" });
      },
      syncNpcRoomSlots() {
        const fx = w.view.fadeRoomsFx;
        // Every npc, not just the player: an npc MOVES between rooms, so where they stand is a
        // uniform of their own rather than an attribute fixed when the map loaded
        for (const npc of Object.values(w.n)) {
          const at = state.npcToRoom.get(npc.key);
          const next = at === undefined ? alwaysShownSlot : slotOf(at.gmId, at.roomId);
          if (next === npc.roomSlot.value) continue;
          // Somebody walking INTO a room that is still arriving keeps the room they came from,
          // which is all there — else they would dim on the threshold, waiting on a room they are
          // already standing in. They take the new one the moment it lands, which is why this runs
          // on the tick as well as on the events that move people between rooms
          if (fx.isArriving(next) === true && fx.hasArrived(npc.roomSlot.value) === true) continue;
          npc.roomSlot.value = next;
        }
        state.syncNpcVisibility();
      },
      syncNpcVisibility() {
        const fx = w.view.fadeRoomsFx;
        for (const npc of Object.values(w.n)) {
          // their own slot, not the room they stand in: whilst a room they have walked into is
          // still arriving they keep the one they came from — see above
          const hidden = fx.isWipedOut(npc.roomSlot.value);
          if (hidden === npc.hidden) continue;
          w.events.next({ key: hidden === true ? "npc-hidden" : "npc-shown", npcKey: npc.key, hidden });
        }
      },
      tryCloseDoor(gdKey) {
        const door = w.door.byKey[gdKey];
        if (!door) return; // onchange map

        w.door.cancelClose(door);
        door.closeTimeoutId = window.setTimeout(() => {
          if (w.disabled === true) {
            // don't close whilst paused (recheck in {ms})
            state.tryCloseDoor(gdKey);
          } else if (door.open === true) {
            state.toggleDoor(gdKey, { clear: state.canAutoCloseDoor(door), close: true });
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
    return () => void sub.unsubscribe();
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
   * Rooms lit BY HAND, shown whatever the player can see — see `setRoomLit`. Distinct from
   * `litRooms`, which is what lit NPCS light, and not gated on `litNpcsEnabled`. Emptied on a map
   * change, a `grKey` meaning nothing to the map coming in
   */
  handLitRooms: Set<Geomorph.GmRoomKey>;
  /**
   * Lights a room by hand, or puts it out; toggles when `next` is omitted. Takes a `grKey` or a
   * `GmRoomId`, and warns rather than throwing where there is no such room
   */
  setRoomLit(input: Geomorph.GmRoomKey | Geomorph.GmRoomId, next?: boolean): void;
  /** Puts out every room lit by hand, leaving what the player can see and the lit npcs */
  clearHandLitRooms(): void;
  /**
   * Which rooms each LIT npc lights, by npc key — what `service/fade-rooms` shows on their account.
   * One room, or TWO whilst they stand in a doorway. By npc rather than by room, so one moving or
   * going out is an entry rewritten or dropped
   */
  litRooms: Map<string, Geomorph.GmRoomId[]>;
  /** Lights `npc` or puts them out. Toggles when `next` is omitted */
  setNpcLit(npc: Npc, next?: boolean): void;
  /**
   * Puts `npc` into `litRooms`, or takes them out of it — see `setNpcLit`.
   *
   * Returns `true` iff npc lit and something was deleted or set.
   * @param alsoAt the far side of the doorway they stand in, if they stand in one
   */
  syncLitRoom(npc: Npc, alsoAt?: Geomorph.GmRoomId): boolean;
  /**
   * Relates `npcKey` to current room.
   */
  npcToRoom: Map<string, Geomorph.GmRoomId>;
  pendingRaycast: { [uid: string]: { resolve(result: WW.RaycastResultResponse): void; reject(): void } };
  pendingUnreachable: {
    [uid: string]: { resolve(result: WW.UnreachableResult): void; reject(err: Error): void };
  };
  /**
   * The "inverse" of npcToRoom i.e. `roomToNpc[gmId][roomId]` is a set of `npcKey`s
   */
  roomToNpcs: { [roomId: number]: Set<string> }[];

  addFrameCallback(cb: () => void): () => void;
  canAutoCloseDoor(door: Geomorph.DoorState): boolean;
  /**
   * - When an npc is moving its destination should be inside a room.
   * - When the npc is in a room adjacent to the destination room,
   *   and the room is inaccessible (e.g. locked doors) we want to avoid
   *   the crowd system redirecting the npc to the "other side of the wall".
   */
  /**
   * Defaults to the npc's current destination. Rejects if the question is abandoned — see
   * `requestUnreachable`, whose rejection it passes on unchanged
   */
  testTargetUnreachable(npc: Npc, dstGrId?: null | Geomorph.GmRoomId): Promise<null | JshCli.NpcUnreachableResult>;
  /** `findPath`, spread over as many turns of the event loop as it takes — see `AStar.searchAsync` */
  findPathAsync(
    srcGrKey: Geomorph.GmRoomKey,
    dstGrKey: Geomorph.GmRoomKey,
    opts?: {
      setNodeWeights?(nodes: Graph.GmRoomGraphNode[]): void;
    },
  ): Promise<AStarSearchResult<Graph.GmRoomGraphNode>>;
  /**
   * The point on navmesh boundary segment `seg` nearest `src` that no door's traffic runs through,
   * or `null` where the whole of it is in the way — see the `park` command
   */
  findClearPointOnSeg(
    src: Geom.VectJson,
    /** A navcat `LocalBoundarySegment`, whose `s` is `[x1, y1, z1, x2, y2, z2]` */
    seg: { s: number[] },
    doors: Geomorph.DoorState[],
  ): null | Geom.VectJson;
  findGmIdContaining(input: MaybeMeta<JshCli.PointAnyFormat>): number | null;
  /**
   * Asks the worker whether this npc can get from one room node to another, and which shut door
   * would stop them if not — see `worker/room-graph.ts`. Resolves `null` for "they can get there".
   * REJECTS when the question is abandoned — `npc.rejectAll`, a map change, or a worker reload —
   * so the caller abandons the move rather than setting off on an answer nobody waited for
   */
  requestUnreachable(npc: Npc, srcIndex: number, dstIndex: number): Promise<WW.UnreachableResult["blocked"]>;
  /** Fails everything waiting on `requestUnreachable`, e.g. because the map is going */
  rejectPendingUnreachable(err: Error): void;
  findRoomContaining(point: MaybeMeta<JshCli.PointAnyFormat>, includeDoors?: boolean): null | Geomorph.GmRoomId;
  getPoint(npcKey: string): Meta<JshCli.GroundPoint>;
  /**
   * @param planning asks whether they COULD pass it, rather than whether they could pass it from
   * where they stand — a locked door standing open counts, since walking up to it is what grants
   * them the crossing. For reachability and the like; leave it off to ask about this moment
   */
  npcCanAccess(npcKey: string, gdKey: Geomorph.GmDoorKey, planning?: boolean): boolean;
  /** Restore this map's npcs, place the player, then maybe run the intro */
  onBootstrapMap(): Promise<void>;
  /** Persist and remove every npc, whilst the outgoing map still exists */
  onChangeMap(): void;
  /** Persist every npc for `w.mapKey`, so `restoreNpcs` can bring them back */
  persistNpcs(): void;
  /** Adopt another world's npcs, lit rooms and locked doors for `w.mapKey`, and apply them */
  restoreFromWorld(fromWorldKey: string): Promise<void>;
  /** Forget this map's saved state, leaving only the player, spawned near the camera */
  resetWorldState(): Promise<void>;
  /** Respawn the npcs persisted for `w.mapKey`, excluding the player */
  restoreNpcs(saved?: null | persisted.PersistedNpcs): Promise<void>;
  onChangeTheme(): void;
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
  toggleDoor(
    gdKey: Geomorph.GmDoorKey,
    opts?: {
      npcKey?: string;
      /**
       * Given `npcIntention` then locked/manual accessible doors will only
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
  /**
   * Snaps open every door an npc is standing in, so none is drawn closed through them — a door
   * starts closed, whereas an npc's saved position can be in a doorway they stopped in
   */
  openDoorwaysWithNpcs(): Promise<void>;
  /** Re-reads which rooms the world is shown in — a door swinging, or the player moving room */
  syncFadeRooms(): void;
  /** Puts every npc in the room they stand in, unless it has yet to arrive — see within */
  syncNpcRoomSlots(): void;
  /**
   * Fires `npc-hidden` / `npc-shown` for whoever `focus` has just wiped away or given back — see
   * `onNpcEvent`, which is where the draw calls are actually given up
   */
  syncNpcVisibility(): void;
  tryCloseDoor(gdKey: Geomorph.GmDoorKey): void;
  tryPutNpcIntoRoom(npc: Npc): void;
};

const emptySet = new Set<Geomorph.GmDoorKey>();

/**
 * How far CLEAR of a door an npc it cannot pass is kept: their own radius, and a margin on top.
 * Their body would otherwise stand through the panel, and reach far enough to trip its inside sensor
 */
const shutDoorKeepOut = npcConfig.dist.agentRadius + npcConfig.dist.shutDoorKeepOut;

const emptyMeta = {};
