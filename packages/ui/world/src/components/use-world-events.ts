import { type UseStateRef, useStateRef } from "@npc-cli/util";
import { useEffect } from "react";

export default function useWorldEvents(w: UseStateRef<import("./World").State>) {
  const state = useStateRef(
    (): State => ({
      doorOpen: {},
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
  onEvent(e: JshCli.Event): void;
};
