import { uiClassName } from "@npc-cli/ui-sdk";
import { useStateRef } from "@npc-cli/util";
import { Suspense } from "react";
import Floor from "./Floor";
import NPCs from "./NPCs";
import type { WorldUiMeta } from "./schema";
import { WorldView } from "./WorldView";
import { WorldContext } from "./world-context";

export default function World(props: { meta: WorldUiMeta }) {
  const state = useStateRef<State>(() => ({
    key: props.meta.worldKey,
    disabled: props.meta.disabled,
  }));

  state.disabled = props.meta.disabled;

  return (
    <WorldContext.Provider value={state}>
      <WorldView className={uiClassName}>
        <ambientLight intensity={1} color="#ffffff" />
        <Floor />
        <Suspense>
          <NPCs />
        </Suspense>
      </WorldView>
    </WorldContext.Provider>
  );
}

export type State = {
  key: WorldUiMeta["worldKey"];
  disabled: boolean;
};
