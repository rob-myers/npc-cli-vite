import { type UseStateRef, useStateRef } from "@npc-cli/util";
import type { Npc } from "./npc";
import type { State as WorldState } from "./World";

/** The npcs near another, a room or a door: the candidates before a test of one's own, e.g. a ray. Mounted at `w.npc.near` */
export default function useNearbyNpcs(w: UseStateRef<WorldState>) {
  const state = useStateRef(
    (): State => ({
      atDoors(npcKey, out = []) {
        for (const gdKey of w.e.npcToDoors[npcKey]?.nearby ?? [])
          for (const key of w.e.doorToNpcs[gdKey]?.nearby ?? []) {
            const npc = key === npcKey ? undefined : w.n[key];
            if (npc !== undefined && out.includes(npc) === false) out.push(npc);
          }
        return out;
      },
      beside(npcKey, within) {
        const neis = w.n[npcKey]?.agent?.neis ?? [];
        return neis.flatMap(({ agentId, dist: distSq }) => {
          const npc = w.npc.byAgentId[agentId];
          return npc === undefined || distSq >= within ** 2 ? [] : [{ npc, dist: Math.sqrt(distSq) }];
        });
      },
      inReach(npcKey, doors = 1) {
        const at = w.npc.npcToRoom.get(npcKey);
        if (at === undefined) return [];
        if (doors === 0) return state.inRooms([at], npcKey);
        if (w.gmRoomGraph.getNode(at.grKey) === null) return [];
        // their room is depth 0, its connectors 1, the rooms beyond those 2
        const rooms = w.gmRoomGraph
          .getReachableUpTo(at.grKey, (node, depth) =>
            node.type === "room"
              ? depth >= doors * 2
              : node.type !== "door" || w.door.isSeenThrough(node.gdKey) === false,
          )
          .flatMap((node) => (node.type === "room" ? [node] : []));
        return state.inRooms(rooms, npcKey);
      },
      inRooms(rooms, exclude, out = []) {
        out.length = 0;
        for (const { gmId, roomId } of rooms)
          for (const key of w.npc.roomToNpcs[gmId]?.[roomId] ?? []) {
            const npc = key === exclude ? undefined : w.n[key];
            if (npc !== undefined) out.push(npc);
          }
        return out;
      },
    }),
  );
  return state;
}

export type State = {
  /** Others near any door `npcKey` is near, either side, added to `out` bar those in it already */
  atDoors(npcKey: string, out?: Npc[]): Npc[];
  /** The crowd's neighbours of `npcKey` within `within` metres, unsorted. Walls are ignored, and an npc without an agent has none */
  beside(npcKey: string, within: number): { npc: Npc; dist: number }[];
  /** Others in the room of `npcKey`, or in rooms up to `doors` doors away (default `1`) through doors seen through */
  inReach(npcKey: string, doors?: number): Npc[];
  /** The npcs in `rooms`, bar `exclude`, written to `out` (cleared first) */
  inRooms(rooms: Iterable<{ gmId: number; roomId: number }>, exclude?: string, out?: Npc[]): Npc[];
};
