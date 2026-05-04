import type { StarShipGeomorphKey } from "@npc-cli/media/starship-symbol";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { Broadcaster, cn, type UseStateRef, useStateRef } from "@npc-cli/util";
import { fetchParsed, getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
import { debug, hashJson, tryLocalStorageGetParsed } from "@npc-cli/util/legacy/generic";
import type { RootState } from "@react-three/fiber";
import { extend } from "@react-three/fiber";
import { useQuery } from "@tanstack/react-query";
import { useContext, useEffect } from "react";
import { useBeforeunload } from "react-beforeunload";
import * as THREE from "three/webgpu";
import { Timer } from "three-stdlib";
import { AssetsSchema, type AssetsType, SheetsSchema, type SheetsType } from "../assets.schema";
import {
  assetsJsonChangedEvent,
  assetsJsonChangingEvent,
  brightnessStorageKey,
  defaultWorldTheme,
  emptyMapDef,
  floorTextureDimension,
  MAX_NPCS,
  mapEditSymbolSavedEvent,
} from "../const";
import type { WorldUiMeta } from "../schema";
import DerivedGmsData from "../service/DerivedGmsData";
import { emptyTiledNavmeshResponse } from "../service/empty-nav-response";
import { createLayoutInstance } from "../service/geomorph";
import { GmGraph } from "../service/gm-graph";
import { GmRoomGraph } from "../service/gm-room-graph";
import { queryClientApi } from "../service/query-client";
import { recomputeHullSymbolUsingDrafts } from "../service/recompute-layout";
import { TexArray } from "../service/tex-array";
import Ceiling from "./Ceiling";
import { Debug } from "./Debug";
import Decor from "./Decor";
import Doors from "./Doors";
import Floor from "./Floor";
import NPCs from "./NPCs";
import Obstacles from "./Obstacles";
import useWorldEvents from "./use-world-events";
import Walls from "./Walls";
import { WorldMenu } from "./WorldMenu";
import { WorldView } from "./WorldView";
import WorldWorker from "./WorldWorker";
import { WorldContext } from "./world-context";

export default function World({ meta }: { meta: WorldUiMeta }) {
  const { uiStoreApi } = useContext(UiContext);

  const state = useStateRef(
    (): State => ({
      id: meta.id,
      key: meta.worldKey,
      disabled: meta.disabled,
      mapKey: meta.mapKey,
      themeKey: meta.themeKey,
      worldQueryPrefix: ["world", meta.worldKey],

      brightness: tryLocalStorageGetParsed(brightnessStorageKey) ?? 1,

      events: new Broadcaster(),
      reqAnimId: -1,
      threeReady: false,
      timer: new Timer(),

      hash: 0,

      // hmr recreates but not named canvas
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
      texDecor: new TexArray({ ctKey: "decor-tex", numTextures: 1, width: 64, height: 64 }),
      texLabel: new TexArray({ ctKey: "npc-labels", width: 256, height: 64, numTextures: MAX_NPCS }),
      texSkin: new TexArray({ ctKey: "npc-skins", width: 64, height: 64, numTextures: MAX_NPCS }),

      gms: [],
      seenGmKeys: [],
      gmsData: new DerivedGmsData(),
      gmGraph: new GmGraph([]),
      gmRoomGraph: new GmRoomGraph(),
      nav: emptyTiledNavmeshResponse,
      navPending: true,

      assets: null as any,
      ceil: null as any,
      decor: null as any,
      door: null as any,
      floor: null as any,
      r3f: null as any,
      obs: null as any,
      sheets: null as any,
      view: null as any,
      wall: null as any,
      menu: { suppressGrayscale: false } as State["menu"],
      npc: null as any,
      worker: null as any,
      e: null as any,
      debug: null as any,

      rootEl: null as any,

      getGmKeyTexId(gmKey: StarShipGeomorphKey) {
        return this.seenGmKeys.indexOf(gmKey);
      },
      getTheme() {
        return state.assets?.theme?.[state.themeKey] ?? defaultWorldTheme;
      },
      isReady(_connectionKey) {
        return !!state.assets && state.nav !== emptyTiledNavmeshResponse;
      },
      onTick() {
        state.reqAnimId = requestAnimationFrame(state.onTick);
        state.timer.update();
        const delta = state.timer.getDelta();
        state.door.onTick(delta);
        state.npc.onTick(delta);
      },
      setDisabled(disabled) {
        uiStoreApi.setUiMeta(meta.id, (draft) => {
          draft.disabled = disabled ?? !state.disabled;
        });
      },
      setupDevAssetsSync() {
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
      setupProdHullAssetsSync() {
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
  state.themeKey = meta.themeKey;

  useEffect(() => {
    queryClientApi.set([meta.worldKey], state);
    return () => queryClientApi.remove([meta.worldKey]);
  }, []); // cache world

  useEffect(() => {
    if (!state.npc) return;
    state.timer.reset();
    state.view?.syncRenderMode();
    if (state.disabled === false) state.onTick();
    state.events.next({ key: state.disabled ? "disabled" : "enabled" });
    return () => state.stopTick();
  }, [state.disabled, state.npc]); // pause/resume

  state.sheets =
    useQuery({
      queryKey: [...state.worldQueryPrefix, "sheets"],
      async queryFn() {
        return await fetchParsed(`/sheets.json${getDevCacheBustQueryParam()}`, SheetsSchema);
      },
    }).data ?? state.sheets; // spritesheets: obstacles...

  useWorldEvents(state);

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

      state.gmGraph = GmGraph.fromGms(state.gms, { permitErrors: true });
      state.gmRoomGraph = GmRoomGraph.fromGmGraph(state.gmGraph);

      return null;
    },
    enabled: state.threeReady, // 🔔 fixes horrible issue on refresh
  }); // query unique to component instance

  useEffect(() => {
    if (import.meta.env.DEV && import.meta.hot) {
      return state.setupDevAssetsSync();
    }
    if (import.meta.env.PROD) {
      return state.setupProdHullAssetsSync();
    }
  }, []); // sync assets in dev/prod

  useBeforeunload(() => {
    state.menu?.persistY();
  });

  return (
    <WorldContext.Provider value={state}>
      <div ref={state.ref("rootEl")} className="relative size-full">
        {state.rootEl && (
          <WorldView
            className={cn(
              state.getTheme().background,
              "bg-[repeating-linear-gradient(45deg,var(--pattern-fg)_0,var(--pattern-fg)_1px,transparent_0,transparent_50%)] bg-[size:10px_10px] bg-fixed [--pattern-fg:color-mix(in_oklch,var(--color-black)_20%,transparent)]",
            )}
          >
            <ambientLight intensity={0.85} color="#ffffff" />
            <Floor key="floor" />
            <Ceiling key="ceiling" />
            <Walls key="walls" />
            <Doors key="doors" />
            <Obstacles key="obstacles" />
            <Decor key="decor" />
            <NPCs key="npcs" />
            <Debug key="debug" />
          </WorldView>
        )}
        <WorldWorker />
        <WorldMenu />
      </div>
    </WorldContext.Provider>
  );
}

export type State = {
  id: string;
  key: WorldUiMeta["worldKey"];
  disabled: boolean;
  mapKey: string;
  themeKey: string;
  worldQueryPrefix: ["world", worldKey: string];

  brightness: number;

  events: Broadcaster<JshCli.Event>;
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
  texDecor: TexArray;
  texLabel: TexArray;
  texSkin: TexArray;

  gms: Geomorph.LayoutInstance[];
  /**
   * Ordered by first time seen in `gms`.
   * Thus `seenGmKeys.indexOf(gmKey)` provides `texId`.
   */
  seenGmKeys: StarShipGeomorphKey[];
  gmsData: DerivedGmsData;
  gmGraph: GmGraph;
  gmRoomGraph: GmRoomGraph;

  ceil: UseStateRef<import("./Ceiling").State>;
  decor: UseStateRef<import("./Decor").State>;
  door: UseStateRef<import("./Doors").State>;
  floor: UseStateRef<import("./Floor").State>;
  obs: UseStateRef<import("./Obstacles").State>;
  view: UseStateRef<import("./WorldView").State>;
  wall: UseStateRef<import("./Walls").State>;
  menu: UseStateRef<import("./WorldMenu").State>;
  npc: UseStateRef<import("./NPCs").State>;
  e: UseStateRef<import("./use-world-events").State>;
  debug: UseStateRef<import("./Debug").State>;

  worker: UseStateRef<import("./WorldWorker").State>;
  nav: WW.TiledNavMeshResponse;
  navPending: boolean;
  rootEl: HTMLDivElement;

  setDisabled(nextDisabled?: boolean): void;
  setupDevAssetsSync(): void;
  getGmKeyTexId(gmKey: StarShipGeomorphKey): number;
  getTheme(): import("../assets.schema").WorldTheme;
  isReady(connectionKey: string): boolean;
  onTick(): void;
  setupProdHullAssetsSync(): void;
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
