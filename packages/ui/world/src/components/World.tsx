import type { StarShipGeomorphKey } from "@npc-cli/media/starship-symbol";
import { uiClassName } from "@npc-cli/ui-sdk/const";
import { Broadcaster, cn, type UseStateRef, useStateRef } from "@npc-cli/util";
import { fetchParsed, getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
import { debug, hashJson, tryLocalStorageGetParsed } from "@npc-cli/util/legacy/generic";
import type { RootState } from "@react-three/fiber";
import { extend } from "@react-three/fiber";
import { useQuery } from "@tanstack/react-query";
import { Suspense, useEffect } from "react";
import * as THREE from "three/webgpu";
import { Timer } from "three-stdlib";
import { AssetsSchema, type AssetsType, SheetsSchema, type SheetsType } from "../assets.schema";
import {
  assetsJsonChangedEvent,
  assetsJsonChangingEvent,
  brightnessStorageKey,
  emptyMapDef,
  floorTextureDimension,
  mapEditSymbolSavedEvent,
} from "../const";
import type { WorldUiMeta } from "../schema";
import DerivedGmsData from "../service/DerivedGmsData";
import { createLayoutInstance } from "../service/geomorph";
import { queryClientApi } from "../service/query-client";
import { recomputeHullSymbolUsingDrafts } from "../service/recompute-layout";
import { TexArray } from "../service/tex-array";
import Ceiling from "./Ceiling";
import { Debug } from "./Debug";
import Floor from "./Floor";
import NPCs from "./NPCs";
import Obstacles from "./Obstacles";
import Walls from "./Walls";
import { WorldContextMenu } from "./WorldMenu";
import { WorldView } from "./WorldView";
import WorldWorker from "./WorldWorker";
import { WorldContext } from "./world-context";

export default function World({ meta }: { meta: WorldUiMeta }) {
  const state = useStateRef(
    (): State => ({
      id: meta.id,
      key: meta.worldKey,
      disabled: meta.disabled,
      mapKey: meta.mapKey,
      worldQueryPrefix: ["world", meta.worldKey],

      brightness: tryLocalStorageGetParsed(brightnessStorageKey) ?? 1,

      events: new Broadcaster(),
      reqAnimId: -1,
      threeReady: false,
      timer: new Timer(),

      hash: 0,
      texFloor: new TexArray({
        ctKey: "floor-tex",
        numTextures: 3, // can change
        width: floorTextureDimension,
        height: floorTextureDimension,
      }),
      texCeil: new TexArray({
        ctKey: "ceil-tex",
        numTextures: 2, // can change
        width: floorTextureDimension,
        height: floorTextureDimension,
      }),
      texObs: new TexArray({
        ctKey: "obs-tex",
        numTextures: 1, // from sheets.symbolSheetDims.length
        width: 1,
        height: 1,
      }),

      gms: [],
      seenGmKeys: [],
      gmsData: new DerivedGmsData(),
      nav: null,
      navPending: true,

      // 🚧 must supply value else hmr removes field
      assets: null as any,
      r3f: null as any,
      sheets: null as any,

      // biome-ignore format: meaningful newlines
      ...{} as Pick<State, (
        | "worker"
        | "ceil"
        | "floor"
        | "obs"
        | "view"
      )>,

      devSetupAssetsSync() {
        const hot = import.meta.hot;
        if (!import.meta.env.DEV || !hot) return;

        // biome-ignore format: succinct
        const listeners: [target: "hot" | "window", event: string, handler: (...args: any[]) => void][] = [
          ["hot", assetsJsonChangingEvent, () => state.set({ navPending: true })],
          ["hot", assetsJsonChangedEvent, () => {
            debug("[World] assets.json changed: refetching");
            queryClientApi.queryClient.invalidateQueries({ exact: false, queryKey: state.worldQueryPrefix });
          }],
          ["window", "hmr:DerivedGmsData", (e: Event) => {
            debug("[World] HMR: DerivedGmsData updated: recomputing");
            state.gmsData = new (e as CustomEvent).detail();
            for (const gmKey of state.seenGmKeys) {
              state.gmsData.computeGmKey(state.assets.layout[gmKey] as Geomorph.Layout);
            }
            state.gmsData.computeRoot(state.gms);
            state.update();
          }],
        ];

        for (const [target, event, handler] of listeners) {
          target === "hot" ? hot.on(event, handler) : window.addEventListener(event, handler);
        }
        return () => {
          for (const [target, event, handler] of listeners) {
            target === "hot" ? hot.off(event, handler) : window.removeEventListener(event, handler);
          }
        };
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
          debug("[World] symbol saved, refetching");
          state.set({ navPending: true });
          queryClientApi.queryClient.invalidateQueries({ exact: false, queryKey: state.worldQueryPrefix });
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
    if (!state.disabled) state.onTick();
    state.events.next({ key: state.disabled ? "disabled" : "enabled" });
    return () => state.stopTick();
  }, [state.disabled]);

  state.sheets =
    useQuery({
      queryKey: [...state.worldQueryPrefix, "sheets"],
      async queryFn() {
        return await fetchParsed(`/sheets.json${getDevCacheBustQueryParam()}`, SheetsSchema);
      },
    }).data ?? state.sheets;

  const _worldQuery = useQuery({
    // Distinct query per World instance even if same map
    queryKey: [...state.worldQueryPrefix, state.mapKey, meta.id],
    async queryFn() {
      state.assets = await fetchParsed(`/assets.json${getDevCacheBustQueryParam()}`, AssetsSchema);

      if (import.meta.env.PROD) {
        recomputeHullSymbolUsingDrafts(state.assets);
      }

      const mapDef = state.assets.map[state.mapKey] ?? emptyMapDef;

      state.gms = mapDef.gms.map(({ gmKey, transform }, gmId) =>
        createLayoutInstance(state.assets.layout[gmKey] as Geomorph.Layout, gmId, transform),
      );
      state.seenGmKeys = state.gms.reduce<StarShipGeomorphKey[]>(
        (agg, { key }) => (agg.includes(key) ? agg : agg.concat(key)),
        [],
      );

      for (const gmKey of state.seenGmKeys) {
        state.gmsData.computeGmKey(state.assets.layout[gmKey] as Geomorph.Layout);
      }
      state.gmsData.computeRoot(state.gms);

      state.hash = hashJson(state.assets);

      // // 🚧 debug: try fix numTextures
      // const dimension = floorTextureDimension;
      // state.texFloor.resize({ width: dimension, height: dimension, numTextures: Math.max(1, state.gms.length) });
      // state.texCeil.resize({ width: dimension, height: dimension, numTextures: Math.max(1, state.seenGmKeys.length) });

      return null;
    },
    enabled: state.threeReady, // 🔔 fixes horrible issue on refresh
  }); // never runs anywhere else, so it may mutate state

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
        {/* 🔔 suspense avoids sporadic silent fail */}
        <Suspense>
          <WorldView className={cn(uiClassName, "bg-gray-500")}>
            <ambientLight intensity={0.85} color="#ffffff" />
            <Floor />
            <Ceiling />
            <Walls />
            <Obstacles />
            {/* 🔔 delay to avoid breaking object-pick async pixel read */}
            {state.assets && <NPCs />}
            <Debug />
          </WorldView>
          <WorldWorker />
        </Suspense>
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
  worldQueryPrefix: ["world", worldKey: string];

  brightness: number;

  events: Broadcaster<NPC.Event>;
  r3f: RootState & { camera: THREE.PerspectiveCamera };
  reqAnimId: number;
  threeReady: boolean;
  timer: Timer;

  assets: AssetsType;
  sheets: SheetsType;
  /** Hash of `w.assets` */
  hash: number;
  texFloor: TexArray;
  texCeil: TexArray;
  texObs: TexArray;

  gms: Geomorph.LayoutInstance[];
  /**
   * Ordered by first time seen in `gms`.
   * Thus `seenGmKeys.indexOf(gmKey)` provides `texId`.
   */
  seenGmKeys: StarShipGeomorphKey[];
  gmsData: DerivedGmsData;

  ceil: UseStateRef<import("./Ceiling").State>;
  floor: UseStateRef<import("./Floor").State>;
  obs: UseStateRef<import("./Obstacles").State>;
  view: UseStateRef<import("./WorldView").State>;

  worker: UseStateRef<import("./WorldWorker").State>;
  nav: null | Pretty<Omit<WW.TiledNavMeshResponse, "type">>;
  navPending: boolean;

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
