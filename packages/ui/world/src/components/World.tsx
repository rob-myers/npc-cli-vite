import { uiClassName } from "@npc-cli/ui-sdk";
import { useStateRef } from "@npc-cli/util";
import { Suspense } from "react";
import type { WorldUiMeta } from "../schema";
import Floor from "./Floor";
import NPCs from "./NPCs";
import { WorldView } from "./WorldView";
import { WorldContext } from "./world-context";

export default function World({ meta }: { meta: WorldUiMeta }) {
  const state = useStateRef<State>(
    () => ({
      key: meta.worldKey,
      disabled: meta.disabled,
      mapKey: meta.mapKey,
    }),
    { deps: [meta] },
  );

  return (
    <WorldContext.Provider value={state}>
      <WorldView className={uiClassName}>
        <ambientLight intensity={0.85} color="#ffffff" />
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
  mapKey: string;
};
