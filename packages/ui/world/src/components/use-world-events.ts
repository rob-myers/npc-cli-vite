import { type UseStateRef, useStateRef } from "@npc-cli/util";
import { useEffect } from "react";
import type { AStarSearchResult } from "../pathfinding/AStar";
import type { State as WorldState } from "./World";

export default function useWorldEvents(w: UseStateRef<WorldState>) {
  const state = useStateRef(
    (): State => ({
      doorOpen: {},

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
        switch (e.key) {
          case "door-open":
            state.doorOpen[e.gdKey] = true;
            break;
          case "door-closed":
            state.doorOpen[e.gdKey] = false;
            break;
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
  findPath(
    src: Geomorph.GmRoomKey,
    dst: Geomorph.GmRoomKey,
    keys?: { [key: Geomorph.GmDoorKey]: boolean },
  ): AStarSearchResult<Graph.GmRoomGraphNode>;
  onEvent(e: JshCli.Event): void;
};
