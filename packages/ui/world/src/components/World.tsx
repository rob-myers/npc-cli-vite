import { uiClassName } from "@npc-cli/ui-sdk";
import { Broadcaster, useStateRef } from "@npc-cli/util";
import type { RootState } from "@react-three/fiber";
import { Suspense, useEffect } from "react";
import type * as THREE from "three";
import { Timer } from "three-stdlib";
import { floorTextureDimension } from "../const";
import type { WorldUiMeta } from "../schema";
import { queryClientApi } from "../service/query-client";
import { TexArray } from "../service/tex-array";
import Floor from "./Floor";
import NPCs from "./NPCs";
import { WorldContextMenu } from "./WorldContextMenu";
import { WorldView } from "./WorldView";
import { WorldContext } from "./world-context";

export default function World({ meta }: { meta: WorldUiMeta }) {
  const state = useStateRef(
    (): State => ({
      id: meta.id,
      key: meta.worldKey,
      disabled: meta.disabled,
      mapKey: meta.mapKey,

      events: new Broadcaster(),
      r3f: null as unknown as State["r3f"],
      reqAnimId: -1,
      threeReady: false,
      timer: new Timer(),

      texFloor: new TexArray({
        ctKey: "floor-tex",
        numTextures: 1, // can change
        width: floorTextureDimension,
        height: floorTextureDimension,
      }),

      view: null as unknown as State["view"],

      onTick() {
        state.reqAnimId = requestAnimationFrame(state.onTick);
        state.timer.update();
        // 🚧 tick subcomponents
      },
      stopTick() {
        cancelAnimationFrame(state.reqAnimId);
        state.reqAnimId = 0;
      },
    }),
  );

  state.disabled = meta.disabled;
  state.mapKey = meta.mapKey;

  // cache world
  useEffect(() => {
    queryClientApi.set([meta.worldKey], state);
    return () => queryClientApi.remove([meta.worldKey]);
  }, []);

  // enable/disable
  useEffect(() => {
    state.timer.reset();
    state.view.syncRenderMode();
    if (!state.disabled) {
      state.onTick();
    }
    state.events.next({ key: state.disabled ? "disabled" : "enabled" });
    return () => state.stopTick();
  }, [state.disabled]);

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
  events: Broadcaster<NPC.Event>;
  mapKey: string;
  r3f: RootState & { camera: THREE.PerspectiveCamera };
  reqAnimId: number;
  threeReady: boolean;
  timer: Timer;

  texFloor: TexArray;

  view: import("./WorldView").State;

  onTick(): void;
  stopTick(): void;
};
