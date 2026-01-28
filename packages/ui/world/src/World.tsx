import { useStateRef } from "@npc-cli/util";
import type { WorldUiMeta } from "./schema";
import { WorldView } from "./WorldView";
import { WorldContext } from "./world-context";

export default function World(props: { meta: WorldUiMeta }) {
  const state = useStateRef<State>(() => ({
    key: props.meta.worldKey,
    disabled: props.meta.disabled,
  }));

  return (
    <WorldContext.Provider value={state}>
      <WorldView></WorldView>
    </WorldContext.Provider>
  );
}

export type State = {
  key: WorldUiMeta["worldKey"];
  disabled: boolean;
};
