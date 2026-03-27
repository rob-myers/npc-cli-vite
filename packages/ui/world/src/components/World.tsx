import type { StarShipGeomorphKey } from "@npc-cli/media/starship-symbol";
import { uiClassName } from "@npc-cli/ui-sdk";
import { Broadcaster, cn, useStateRef } from "@npc-cli/util";
import { fetchParsed, getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
import { hashJson } from "@npc-cli/util/legacy/generic";
import type { RootState } from "@react-three/fiber";
import { extend } from "@react-three/fiber";
import { useQuery } from "@tanstack/react-query";
import { Suspense, useEffect } from "react";
import * as THREE from "three/webgpu";
import { Timer } from "three-stdlib";
import { AssetsSchema, type AssetsType, type GeomorphLayoutInstance } from "../assets.schema";
import { assetsJsonChangedEvent, emptyMapDef, floorTextureDimension, mapEditSymbolSavedEvent } from "../const";
import type { WorldUiMeta } from "../schema";
import * as geomorph from "../service/geomorph";
import { queryClientApi } from "../service/query-client";
import { recomputeHullSymbolFromLocalStorageDrafts } from "../service/recompute-layout";
import { TexArray } from "../service/tex-array";
import { Debug } from "./Debug";
import Floor from "./Floor";
import NPCs from "./NPCs";
import { WorldContextMenu } from "./WorldContextMenu";
import { WorldView } from "./WorldView";
import { WorldContext } from "./world-context";

export default function World({ meta }: { meta: WorldUiMeta }) {
  const state = useStateRef(
    (): State => ({
      //#region core properties

      id: meta.id,
      key: meta.worldKey,
      disabled: meta.disabled,
      mapKey: meta.mapKey,
      assetsQueryPrefix: ["world", meta.worldKey],

      //#endregion
      //#region core setup and communication
      events: new Broadcaster(),
      r3f: null as unknown as State["r3f"],
      reqAnimId: -1,
      threeReady: false,
      timer: new Timer(),

      //#endregion
      //#region texture atlases

      assets: null as unknown as State["assets"],
      hash: 0,
      texFloor: new TexArray({
        ctKey: "floor-tex",
        numTextures: 1, // can change
        width: floorTextureDimension,
        height: floorTextureDimension,
      }),

      //#endregion
      //#region derived state

      gms: [],
      seenGmKeys: [],

      //#endregion
      //#region subcomponent apis

      view: null as unknown as State["view"],

      //#endregion

      devSetupAssetsSync() {
        if (!import.meta.env.DEV || !import.meta.hot) return;
        // refetch on assets.json change (DEV)
        const hot = import.meta.hot;
        const cb = () => {
          console.log("[World] assets.json changed, refetching");
          queryClientApi.queryClient.invalidateQueries({ exact: false, queryKey: state.assetsQueryPrefix });
        };
        hot.on(assetsJsonChangedEvent, cb);
        return () => hot.off(assetsJsonChangedEvent, cb);
      },
      getGmKeyTexId(gmKey: StarShipGeomorphKey) {
        return this.seenGmKeys.indexOf(gmKey);
      },
      onTick() {
        state.reqAnimId = requestAnimationFrame(state.onTick);
        state.timer.update();
        // 🚧 tick subcomponents
      },
      prodSetupHullAssetsSync() {
        const cb = () => {
          console.log("[World] symbol saved, refetching");
          queryClientApi.queryClient.invalidateQueries({ exact: false, queryKey: state.assetsQueryPrefix });
        };
        window.addEventListener(mapEditSymbolSavedEvent, cb);
        return () => window.removeEventListener(mapEditSymbolSavedEvent, cb);
      },
      stopTick() {
        cancelAnimationFrame(state.reqAnimId);
        state.reqAnimId = 0;
      },
    }),
  );

  state.disabled = meta.disabled;
  state.mapKey = meta.mapKey;

  useEffect(() => {
    queryClientApi.set([meta.worldKey], state);
    return () => queryClientApi.remove([meta.worldKey]);
  }, []); // cache world

  useEffect(() => {
    state.timer.reset();
    state.view.syncRenderMode();
    if (!state.disabled) {
      state.onTick();
    }
    state.events.next({ key: state.disabled ? "disabled" : "enabled" });
    return () => state.stopTick();
  }, [state.disabled]);

  /**
   * This query never runs anywhere else so we may mutate state.
   */
  const _query = useQuery({
    queryKey: [...state.assetsQueryPrefix, state.mapKey],
    async queryFn() {
      const assets = await fetchParsed(`/assets.json${getDevCacheBustQueryParam()}`, AssetsSchema);
      state.assets = assets;
      if (import.meta.env.PROD) {
        recomputeHullSymbolFromLocalStorageDrafts(assets);
      }

      const mapDef = assets.map[state.mapKey] ?? emptyMapDef;

      state.gms = mapDef.gms.map(({ gmKey, transform }, gmId) =>
        geomorph.createLayoutInstance(assets.layout[gmKey] as Geomorph.Layout, gmId, transform),
      );
      state.seenGmKeys = state.gms.reduce<StarShipGeomorphKey[]>(
        (agg, { key }) => (agg.includes(key) ? agg : agg.concat(key)),
        [],
      );

      state.hash = hashJson(assets);

      return null;
    },
  });

  useEffect(() => {
    if (import.meta.env.DEV && import.meta.hot) {
      return state.devSetupAssetsSync();
    }
    if (import.meta.env.PROD) {
      return state.prodSetupHullAssetsSync();
    }
  }, []); // sync assets in dev/prod

  return (
    <WorldContext.Provider value={state}>
      <div className="relative size-full">
        <WorldView className={cn(uiClassName, "bg-zinc-800")}>
          <ambientLight intensity={0.85} color="#ffffff" />
          <Floor />
          <Suspense>
            <NPCs />
          </Suspense>
          <Debug />
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
  assetsQueryPrefix: ["world", worldKey: string];

  events: Broadcaster<NPC.Event>;
  r3f: RootState & { camera: THREE.PerspectiveCamera };
  reqAnimId: number;
  threeReady: boolean;
  timer: Timer;

  assets: AssetsType;
  hash: number;
  texFloor: TexArray;

  gms: GeomorphLayoutInstance[];
  /**
   * Ordered by first time seen in `gms`.
   * Thus `seenGmKeys.indexOf(gmKey)` provides `texId`.
   */
  seenGmKeys: StarShipGeomorphKey[];

  view: import("./WorldView").State;

  devSetupAssetsSync(): void;
  getGmKeyTexId(gmKey: StarShipGeomorphKey): number;
  onTick(): void;
  prodSetupHullAssetsSync(): void;
  stopTick(): void;
};

extend({ MeshStandardNodeMaterial: THREE.MeshStandardNodeMaterial });

declare module "@react-three/fiber" {
  interface ThreeElements {
    meshStandardNodeMaterial: ThreeElements["meshStandardMaterial"] & {
      colorNode?: THREE.MeshStandardNodeMaterial["colorNode"];
      normalNode?: THREE.MeshStandardNodeMaterial["normalNode"];
      emissiveNode?: THREE.MeshStandardNodeMaterial["emissiveNode"];
      roughnessNode?: THREE.MeshStandardNodeMaterial["roughnessNode"];
      metalnessNode?: THREE.MeshStandardNodeMaterial["metalnessNode"];
    };
  }
}
