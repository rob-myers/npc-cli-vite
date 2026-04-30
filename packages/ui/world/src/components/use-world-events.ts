import { type UseStateRef, useStateRef } from "@npc-cli/util";
import { useEffect } from "react";

export default function useWorldEvents(w: UseStateRef<import("./World").State>) {
  const state = useStateRef(
    (): State => ({
      doorOpen: {},
      findPath(src: Geomorph.GmRoomKey, dst: Geomorph.GmRoomKey) {
        return w.gmRoomGraph.findPath(src, dst, (nodes) => {
          for (const node of nodes) {
            if (node.type === "door" && !state.doorOpen[node.id]) {
              node.astar.closed = true;
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
  findPath(src: Geomorph.GmRoomKey, dst: Geomorph.GmRoomKey): Graph.GmRoomGraphNode[] | null;
  onEvent(e: JshCli.Event): void;
};
