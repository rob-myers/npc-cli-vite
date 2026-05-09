import { type UseStateRef, useStateRef } from "@npc-cli/util";
import { pause, warn } from "@npc-cli/util/legacy/generic";
import { useEffect } from "react";
import { defaultDoorCloseMs } from "../const";
import type { AStarSearchResult } from "../pathfinding/AStar";
import { groundPointToVector3, parseGroundPoint } from "../service/geometry";
import { helper } from "../service/helper";
import { npcToBodyKey } from "../service/physics-bijection";
import type { Npc } from "./npc";
import type { State as WorldState } from "./World";

export default function useWorldEvents(w: UseStateRef<WorldState>) {
  const state = useStateRef(
    (): State => ({
      doorOpen: {},
      doorToNpcs: {},
      externalNpcs: new Set(),
      npcToDoors: {},
      npcToRoom: new Map(),
      roomToNpcs: [],

      canCloseDoor(door) {
        const closeNpcs = state.doorToNpcs[door.gdKey];
        if (closeNpcs === undefined) {
          return true;
        } else if (closeNpcs.inside.size > 0) {
          return false; // nope: npc(s) using doorway
        } else if (closeNpcs.nearby.size === 0) {
          return true;
        } else if (door.auto === true && door.locked === false) {
          return false; // nope: npc(s) trigger sensor
        }
        return true;
      },
      findPath(src, dst, keys = {}) {
        return w.gmRoomGraph.findPath(src, dst, (nodes) => {
          for (const node of nodes) {
            if (node.type === "door" && !state.doorOpen[node.id]) {
              node.astar.closed = keys[node.id] !== true;
            }
          }
        });
      },
      findGmIdContaining(input) {
        if (typeof input.meta?.gmId === "number") {
          return input.meta.gmId;
        }
        return w.gmGraph.findGmIdContaining(parseGroundPoint(input));
      },
      findRoomContaining(input, includeDoors = false) {
        if (helper.isGmRoomId(input.meta) === true) {
          // 🔔 existing input.meta overrides includeDoors `false`
          return { ...input.meta };
        }
        const gmId = state.findGmIdContaining(input);
        if (typeof gmId === "number") {
          const point = parseGroundPoint(input);
          const gm = w.gms[gmId];
          const localPoint = gm.inverseMatrix.transformPoint({ x: point.x, y: point.y });
          const roomId = w.gmsData.findRoomIdContaining(gm, localPoint, includeDoors);
          return roomId === null ? null : { gmId, roomId, grKey: helper.getGmRoomKey(gmId, roomId) };
        } else {
          return null;
        }
      },
      npcCanAccess(_npcKey, gdKey) {
        // 🚧 npc can have key
        return w.d[gdKey].locked === false;
      },
      onEvent(e) {
        if ("npcKey" in e) {
          return state.onNpcEvent(e);
        }
        switch (e.key) {
          case "door-open":
            state.doorOpen[e.gdKey] = true;
            break;
          case "door-closed":
            state.doorOpen[e.gdKey] = false;
            break;
          case "removed-npcs": {
            w.worker.worker.postMessage({
              type: "remove-bodies",
              bodyKeys: e.npcKeys.map(npcToBodyKey),
            });

            for (const npcKey of e.npcKeys) {
              const gmRoomId = state.npcToRoom.get(npcKey);
              if (gmRoomId !== undefined) {
                state.npcToRoom.delete(npcKey);
                state.roomToNpcs[gmRoomId.gmId][gmRoomId.roomId].delete(npcKey);
              } else {
                state.externalNpcs.delete(npcKey);
              }

              state.removeFromSensors(...e.npcKeys);
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
        }
      },
      onEnterCollider(e, _npc) {
        if (e.type === "nearby") {
          const door = w.d[e.gdKey];
          if (door.open === true) {
            return; // door already open
          }

          if (door.auto === true && door.locked === false) {
            // only auto-open doors which are auto and unlocked
            state.toggleDoor(e.gdKey, { open: true, npcKey: e.npcKey });
            return;
          }
        }
      },
      onExitCollider(e, npc) {
        if (e.type === "inside") {
          // trigger enter-room on exit inside-collider and changed room
          const gmRoomId = state.npcToRoom.get(npc.key);
          const nextGmRoomId = state.findRoomContaining(npc.position);
          if (gmRoomId === undefined || nextGmRoomId === null || nextGmRoomId.grKey === gmRoomId.grKey) {
            return;
          }
          w.events.next({ key: "enter-room", npcKey: npc.key, gmRoomId: nextGmRoomId });
        }

        if (e.type === "nearby") {
          // try close door under conditions
          const door = w.door.byKey[e.gdKey];
          if (door.open === true) {
            return;
          } else if (door.locked === true) {
            state.tryCloseDoor(e.gdKey);
          } else if (door.auto === true && state.doorToNpcs[e.gdKey]?.nearby.size === 0) {
            // if auto and none nearby, try close
            state.tryCloseDoor(e.gdKey);
          }
        }
      },
      onNpcEvent(e) {
        const npc = w.npc.npc[e.npcKey];
        switch (e.key) {
          case "enter-collider": {
            if (e.type === "nearby") {
              (state.doorToNpcs[e.gdKey] ??= { inside: new Set(), nearby: new Set() }).nearby.add(npc.key);
              (state.npcToDoors[e.npcKey] ??= { inside: null, nearby: new Set() }).nearby.add(e.gdKey);
            }
            if (e.type === "inside") {
              (state.doorToNpcs[e.gdKey] ??= { inside: new Set(), nearby: new Set() }).inside.add(npc.key);
              (state.npcToDoors[e.npcKey] ??= { inside: null, nearby: new Set() }).inside = e.gdKey;
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
              state.doorToNpcs[e.gdKey].nearby?.delete(npc.key);
              state.npcToDoors[e.npcKey].nearby?.delete(e.gdKey);
            }
            if (e.type === "inside") {
              state.doorToNpcs[e.gdKey].inside?.delete(npc.key);
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
            }

            state.npcToRoom.set(npc.key, { ...e.gmRoomId });
            (state.roomToNpcs[e.gmRoomId.gmId][e.gmRoomId.roomId] ??= new Set()).add(e.npcKey);

            break;
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
      removeFromSensors(..._npcKeys) {
        // 🚧 needed on removed-npcs?
      },
      toggleDoor(gdKey, opts = {}) {
        const door = w.door.byKey[gdKey];

        // clear if already closed and no npc colliding with "inside" collider
        // opts.clear = door.open === false || !(state.doorToOffMesh[gdKey]?.length > 0);
        opts.clear = true; // 🚧 state.doorToNpcs.inside.length

        opts.access ??=
          opts.npcKey === undefined ||
          (door.auto === true && door.locked === false) ||
          state.npcCanAccess(opts.npcKey, gdKey);

        return w.door.toggleDoor(door, opts);
      },
      toggleLock(gdKey, opts = {}) {
        const door = w.door.byKey[gdKey];

        if (opts.point === undefined || opts.npcKey === undefined) {
          // e.g. game master i.e. no npc
          return w.door.toggleLock(door, opts);
        }

        const { position: npcPoint } = w.npc.npc[opts.npcKey];
        if (npcPoint.distanceTo(groundPointToVector3(parseGroundPoint(opts.point))) > 1.5) {
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
            w.door.toggleDoor(door, {
              clear: state.canCloseDoor(door) === true,
            });
            state.tryCloseDoor(gdKey); // recheck in {ms}
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
  doorOpen: { [gmDoorKey: Geomorph.GmDoorKey]: boolean | undefined };
  doorToNpcs: { [gmDoorKey: Geomorph.GmDoorKey]: { nearby: Set<string>; inside: Set<string> } };
  externalNpcs: Set<string>;
  npcToDoors: { [npcKey: string]: { inside: null | Geomorph.GmDoorKey; nearby: Set<Geomorph.GmDoorKey> } };
  /**
   * Relates `npcKey` to current room.
   */
  npcToRoom: Map<string, Geomorph.GmRoomId>;
  /**
   * The "inverse" of npcToRoom i.e. `roomToNpc[gmId][roomId]` is a set of `npcKey`s
   */
  roomToNpcs: { [roomId: number]: Set<string> }[];

  canCloseDoor(door: Geomorph.DoorState): boolean;
  findPath(
    src: Geomorph.GmRoomKey,
    dst: Geomorph.GmRoomKey,
    keys?: { [key: Geomorph.GmDoorKey]: boolean },
  ): AStarSearchResult<Graph.GmRoomGraphNode>;
  findGmIdContaining(input: MaybeMeta<JshCli.PointAnyFormat>): number | null;
  findRoomContaining(point: MaybeMeta<JshCli.PointAnyFormat>, includeDoors?: boolean): null | Geomorph.GmRoomId;
  npcCanAccess(npcKey: string, gdKey: Geomorph.GmDoorKey): boolean;
  onEvent(e: JshCli.Event): void;
  onEnterCollider(e: JshCli.EnterColliderEvent, npc: Npc): void;
  onExitCollider(e: JshCli.ExitColliderEvent, npc: Npc): void;
  onNpcEvent(e: Extract<JshCli.Event, { npcKey: string }>): void;
  recomputeNpcRoomRelationships(): void;
  removeFromSensors(...npcKeys: string[]): void;
  toggleDoor(gdKey: Geomorph.GmDoorKey, opts?: { npcKey?: string } & Geomorph.ToggleDoorOpts): boolean;
  toggleLock(
    gdKey: Geomorph.GmDoorKey,
    opts: { npcKey?: string; point?: JshCli.PointAnyFormat } & Geomorph.ToggleLockOpts,
  ): boolean;
  tryCloseDoor(gdKey: Geomorph.GmDoorKey): void;
  tryPutNpcIntoRoom(npc: Npc): void;
};
