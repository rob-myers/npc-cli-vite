import { type UseStateRef, useStateRef } from "@npc-cli/util";
import { pause, warn } from "@npc-cli/util/legacy/generic";
import { useEffect } from "react";
import type { AStarSearchResult } from "../pathfinding/AStar";
import { npcToBodyKey } from "../service/physics-bijection";
import type { Npc } from "./npc";
import type { State as WorldState } from "./World";

export default function useWorldEvents(w: UseStateRef<WorldState>) {
  const state = useStateRef(
    (): State => ({
      doorOpen: {},
      externalNpcs: new Set(),
      npcToRoom: new Map(),
      roomToNpcs: [],

      findPath(src, dst, keys = {}) {
        return w.gmRoomGraph.findPath(src, dst, (nodes) => {
          for (const node of nodes) {
            if (node.type === "door" && !state.doorOpen[node.id]) {
              node.astar.closed = keys[node.id] !== true;
            }
          }
        });
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
          case "requested-physics": {
            state.recomputeNpcRoomRelationships();
            break;
          }
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

              // state.removeFromSensors(...e.npcKeys);

              // // npc might have been inside a doorway
              // const gdKey = state.npcToDoors[npcKey]?.inside;
              // if (typeof gdKey === 'string') {
              //   state.npcToDoors[npcKey].inside = null;
              //   state.doorToOffMesh[gdKey] = (state.doorToOffMesh[gdKey] ?? []).filter(
              //     x => x.npcKey !== npcKey
              //   );
              // }
            }

            break;
          }
        }
      },
      onNpcEvent(e) {
        const npc = w.npc.npc[e.npcKey];
        switch (e.key) {
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
      tryPutNpcIntoRoom(npc) {
        const grId = w.npc.findRoomContaining(npc.position, true);
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
  externalNpcs: Set<string>;
  /**
   * Relates `npcKey` to current room.
   */
  npcToRoom: Map<string, Geomorph.GmRoomId>;
  /**
   * The "inverse" of npcToRoom i.e. `roomToNpc[gmId][roomId]` is a set of `npcKey`s
   */
  roomToNpcs: { [roomId: number]: Set<string> }[];

  findPath(
    src: Geomorph.GmRoomKey,
    dst: Geomorph.GmRoomKey,
    keys?: { [key: Geomorph.GmDoorKey]: boolean },
  ): AStarSearchResult<Graph.GmRoomGraphNode>;
  onEvent(e: JshCli.Event): void;
  onNpcEvent(e: Extract<JshCli.Event, { npcKey: string }>): void;
  recomputeNpcRoomRelationships(): void;
  tryPutNpcIntoRoom(npc: Npc): void;
};
