import { uiClassName } from "@npc-cli/ui-sdk";
import { useStateRef } from "@npc-cli/util";
import { Suspense } from "react";
import type { WorldUiMeta } from "../schema";
import Floor from "./Floor";
import NPCs from "./NPCs";
import { WorldContextMenu } from "./WorldContextMenu";
import { WorldView } from "./WorldView";
import { WorldContext } from "./world-context";

export default function World({ meta }: { meta: WorldUiMeta }) {
  const state = useStateRef<State>(() => ({
    id: meta.id,
    key: meta.worldKey,
    disabled: meta.disabled,
    mapKey: meta.mapKey,
  }));

  // faster than state deps:[meta]
  state.disabled = meta.disabled;
  state.mapKey = meta.mapKey;

  return (
    <WorldContext.Provider value={state}>
      <div className="relative size-full">
        <WorldView className={uiClassName}>
          <ambientLight intensity={0.85} color="#ffffff" />
          <Floor />
          <Suspense>
            <NPCs />
          </Suspense>
        </WorldView>
        <WorldContextMenu />
      </div>
    </WorldContext.Provider>
  );
}

export type State = {
  id: string;
  key: WorldUiMeta["worldKey"];
  disabled: boolean;
  mapKey: string;
};
