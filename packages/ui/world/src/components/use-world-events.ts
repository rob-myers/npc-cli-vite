import { type UseStateRef, useStateRef } from "@npc-cli/util";
import { useEffect } from "react";

export default function useWorldEvents(w: UseStateRef<import("./World").State>) {
  const state = useStateRef(
    (): State => ({
      onEvent(e) {
        switch (e.key) {
          case "door-open":
            // 🚧 sync with `w.npc.doorAreaOpen`
            break;
          case "door-closed":
            // 🚧 sync with `w.npc.doorAreaOpen`
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
  onEvent(e: JshCli.Event): void;
};
