import type { StarShipGeomorphKey } from "@npc-cli/media/starship-symbol";
import { devMessageFromServer } from "@npc-cli/ui__map-edit/map-node-api";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { Broadcaster, cn, type UseStateRef, useBeforeUnloadOrVisibilityChange, useStateRef } from "@npc-cli/util";
import { fetchParsed, getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
import { isTouchDevice, loadImage } from "@npc-cli/util/legacy/dom";
import { debug, entries, hashJson, tryLocalStorageGetParsed } from "@npc-cli/util/legacy/generic";
import type { RootState, RootStore } from "@react-three/fiber";
import { extend } from "@react-three/fiber";
import { useQuery } from "@tanstack/react-query";
import { useContext, useEffect } from "react";
import * as THREE from "three/webgpu";
import { Timer } from "three-stdlib";
import type { OverrideProperties } from "type-fest";
import { AssetsSchema, type AssetsType, SheetsSchema, type SheetsType } from "../assets.schema";
import {
  assetsJsonChangedEvent,
  assetsJsonChangingEvent,
  brightnessStorageKey,
  defaultBrightness,
  defaultWorldTheme,
  emptyMapDef,
  floorTextureDimension,
  MAX_DOOR_LABELS,
  MAX_NPCS,
  mapEditSymbolSavedEvent,
} from "../const";
import type { WorldUiMeta } from "../schema";
import DerivedGmsData from "../service/DerivedGmsData";
import { emptyTiledNavmeshResponse } from "../service/empty-nav-response";
import { createLayoutInstance } from "../service/geomorph";
import { GmGraph } from "../service/gm-graph";
import { GmRoomGraph } from "../service/gm-room-graph";
import { helper } from "../service/helper";
import { queryClientApi } from "../service/query-client";
import { recomputeAssetsViaDrafts } from "../service/recompute-assets";
import { TexArray } from "../service/tex-array";
import Ceiling from "./Ceiling";
import { Debug } from "./Debug";
import Decor from "./Decor";
import Doors from "./Doors";
import Floor from "./Floor";
import Lights from "./Lights";
import NPCs from "./NPCs";
import NpcRings from "./NpcRings";
import NpcShadows from "./NpcShadows";
import Obstacles from "./Obstacles";
import useWorldEvents from "./use-world-events";
import Walls from "./Walls";
import { WorldMenu } from "./WorldMenu";
import { WorldSpeech } from "./WorldSpeech";
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

      brightness: tryLocalStorageGetParsed(brightnessStorageKey) ?? defaultBrightness,

      events: new Broadcaster(),
      reqAnimId: -1,
      threeReady: false,
      timer: new Timer(),
      touchDevice: isTouchDevice(),

      hash: 0,
      gmsHash: 0,
      lastHmr: 0,
      lastQuery: 0,

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
        // anisotropy: 16,
      }),
      texObs: new TexArray({
        ctKey: "obs-tex",
        numTextures: 1, // from sheets.symbolSheetDims.length
        width: 1,
        height: 1,
      }),
      texDecor: new TexArray({ ctKey: "decor-tex", numTextures: 1, width: 64, height: 64 }),
      texDoorLabel: new TexArray({ ctKey: "door-labels", width: 256, height: 512, numTextures: MAX_DOOR_LABELS }),
      texNpcLabel: new TexArray({ ctKey: "npc-labels", width: 256, height: 64, numTextures: MAX_NPCS }),
      texSkin: new TexArray({ ctKey: "npc-skins", width: 256, height: 256, numTextures: MAX_NPCS }),

      assets: null as any,
      sheets: null as any,
      gms: [],
      seenGmKeys: [],
      gmsData: new DerivedGmsData(),
      gmGraph: new GmGraph([]),
      gmRoomGraph: new GmRoomGraph(),
      nav: emptyTiledNavmeshResponse,
      pending: {},
      r3f: null as any,
      r3fStore: null as any,

      b: null as any,
      bubble: null as any,
      ceil: null as any,
      debug: null as any,
      decor: { ready: false } as State["decor"],
      door: null as any,
      d: null as any,
      e: null as any,
      floor: null as any,
      menu: {} as State["menu"],
      npc: null as any,
      n: null as any,
      obs: null as any,
      rings: null as any,
      shadows: null as any,
      speech: null as any,
      view: { roomLightEditingEnabled: true } as State["view"],
      wall: null as any,
      worker: { worker: { postMessage() {} } } as any,

      helper,

      fadeEl: null,
      rootEl: null as any,

      getGmKeyTexId(gmKey: StarShipGeomorphKey) {
        return this.seenGmKeys.indexOf(gmKey);
      },
      getTheme() {
        return state.assets?.theme?.[state.themeKey] ?? defaultWorldTheme;
      },
      isPlaygroundMap() {
        if (state.mapKey.endsWith("-playground")) return true;
        const mapDef = state.assets.map[state.mapKey] ?? emptyMapDef;
        return mapDef.gms.some(({ gmKey }) => gmKey.endsWith("--playground"));
      },
      isReady(_connectionKey) {
        return !!state.assets && state.nav !== emptyTiledNavmeshResponse;
      },
      async loadDecorImages() {
        return await Promise.all(
          Array.from({ length: state.sheets?.decorSheetDims.length ?? 0 }, (_, i) =>
            loadImage(`/sheet/decor.${i}.png${getDevCacheBustQueryParam()}`),
          ),
        );
      },
      onTick() {
        state.reqAnimId = requestAnimationFrame(state.onTick);
        state.timer.update();
        const delta = state.timer.getDelta();
        state.door.onTick(delta);
        state.npc.onTick(delta);
        state.view.dynamicLight.tick(delta);

        if (state.view.dynamicLight.target) {
          state.view.updateDynamicLight(state.view.dynamicLight.target);
        }
      },
      setCanvasFade(on) {
        if (!state.fadeEl) return;
        state.fadeEl.style.transitionDuration = on ? "0.3s" : "0.75s";
        state.fadeEl.style.opacity = on ? "1" : "0";
      },
      setDisabled(disabled) {
        uiStoreApi.setUiMeta(meta.id, (draft) => {
          draft.disabled = disabled ?? !state.disabled;
        });
      },
      setNextPending(partial) {
        const next = { ...state.pending };
        for (const [key, value] of entries(partial)) value ? (next[key] = true) : delete next[key];
        state.set({ pending: next });
      },
      setupDevAssetsSync() {
        const hot = import.meta.hot;
        if (!(import.meta.env.DEV && hot)) return () => {};

        // biome-ignore format: succinct
        const listeners: [event: string, handler: (...args: any[]) => void][] = [
          [assetsJsonChangingEvent, () => {
            state.setNextPending({ assets: true });
          }],
          [assetsJsonChangedEvent, () => {
            debug("[World] assets.json changed: refetching");
            queryClientApi.queryClient.invalidateQueries({ exact: false, queryKey: state.worldQueryPrefix });
          }],
          [devMessageFromServer.decorSheetsRebuilt, async () => {
            debug("[World] decor sheets rebuilt: refetching");
            await queryClientApi.queryClient.invalidateQueries({ queryKey: [...state.worldQueryPrefix, "sheets"] });
            // ensure `state.sheets` reflects the refetch before dependants redraw from it
            const freshSheets = queryClientApi.queryClient.getQueryData<SheetsType>([
              ...state.worldQueryPrefix,
              "sheets",
            ]);
            if (freshSheets) state.sheets = freshSheets;

            queryClientApi.queryClient.invalidateQueries({ queryKey: ["decor-setup"] });

            state.door?.drawDoorTextures().then(() => {
              state.door.sendDataToGpu();
              state.door.update();
            });
          }],
          [devMessageFromServer.skinSheetsRebuilding, () => {
            state.setNextPending({ skins: true });
          }],
          [devMessageFromServer.skinSheetsRebuilt, async () => {
            debug("[World] skin sheets rebuilt: refetching");
            // await pause(100);
            await queryClientApi.queryClient.invalidateQueries({ queryKey: [...state.worldQueryPrefix, "sheets"] });
            queryClientApi.queryClient.invalidateQueries({ queryKey: [...state.worldQueryPrefix, "skins-and-gltf"] });
          }],
          [devMessageFromServer.skinSvgsChanged, async () => {
            debug("[World] skin svgs changed");
            await queryClientApi.queryClient.invalidateQueries({ queryKey: [...state.worldQueryPrefix, "sheets"] });
            queryClientApi.queryClient.invalidateQueries({ queryKey: [...state.worldQueryPrefix, "skins-and-gltf"] });
          }],
        ];

        listeners.forEach(([event, handler]) => hot.on(event, handler));
        return () => listeners.forEach(([event, handler]) => hot.off(event, handler));
      },
      setupDraftAssetsSync() {
        const cb = () => {
          debug("[World] MapEdit drafts changed: recomputing");
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
    { reset: { helper: true } },
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
    }).data ?? state.sheets; // spritesheets: decor, skins, symbols (obstacles)

  useWorldEvents(state);

  // distinct query per World instance even if same map
  state.lastQuery = useQuery({
    queryKey: [...state.worldQueryPrefix, state.mapKey, meta.id, state.lastHmr],
    async queryFn() {
      if (import.meta.hot?.data.__JUST_HMR_WORLD__) {
        import.meta.hot.data.__JUST_HMR_WORLD__ = false;
        state.set({ lastHmr: Date.now() });
        return null; // ignore 1st stale invoke after HMR
      }

      // decor not ready until Decor query runs
      state.decor.ready = false;

      state.setNextPending({ assets: true });
      state.assets = await fetchParsed(`/assets.json${getDevCacheBustQueryParam()}`, AssetsSchema);

      if (state.isPlaygroundMap()) {
        await recomputeAssetsViaDrafts(state.assets);
      }

      const mapDef = state.assets.map[state.mapKey] ?? emptyMapDef;

      state.gms = mapDef.gms.map(({ gmKey, transform }, gmId) =>
        createLayoutInstance(state.assets.layout[gmKey] as Geomorph.Layout, gmId, transform),
      );

      state.seenGmKeys = state.gms.reduce<StarShipGeomorphKey[]>(
        (agg, { key }) => (agg.includes(key) ? agg : agg.concat(key)),
        [],
      );

      // reinstantiate in case changed
      state.gmsData = new DerivedGmsData();

      for (const gmKey of state.seenGmKeys) {
        state.gmsData.computeGmKey(state.assets.layout[gmKey] as Geomorph.Layout);
      }
      state.gmsData.computeRoot(state.gms);

      state.hash = hashJson(state.assets);
      state.gmsHash = hashJson(state.gms);

      state.gmGraph = GmGraph.fromGms(state.gms, { permitErrors: true });
      state.gmRoomGraph = GmRoomGraph.fromGmGraph(state.gmGraph);

      state.setNextPending({ assets: false });
      return null;
    },
    enabled: state.threeReady, // 🔔 fixes horrible issue on refresh
    gcTime: 0,
  }).dataUpdatedAt;

  useEffect(() => {
    if (import.meta.env.DEV && import.meta.hot) return state.setupDevAssetsSync();
  }, []); // sync dev assets

  useEffect(() => {
    if (state.assets && state.isPlaygroundMap()) return state.setupDraftAssetsSync();
  }, [state.mapKey, state.hash]); // sync drafts when relevant

  useBeforeUnloadOrVisibilityChange(() => {
    state.menu?.persistY();
    state.speech?.persistY();
  });

  return (
    <WorldContext.Provider value={state}>
      <div ref={state.ref("rootEl")} className="relative size-full">
        {state.rootEl && (
          <WorldView
            className={
              state.assets &&
              cn(
                state.getTheme().background,
                // these stripes can show through floor
                "bg-[repeating-linear-gradient(45deg,var(--pattern-fg)_0,var(--pattern-fg)_1px,transparent_0,transparent_50%)] bg-size-[8px_8px] bg-fixed [--pattern-fg:color-mix(in_oklch,var(--color-gray-500)_20%,transparent)]",
              )
            }
          >
            <Lights />
            <Floor key="floor" />
            <Ceiling key="ceiling" />
            <Walls key="walls" />
            <Doors key="doors" />
            <Obstacles key="obstacles" />
            <Decor key="decor" />
            <NpcShadows key="npc-shadows" />
            <NpcRings key="npc-rings" />
            <NPCs key="npcs" />
            <Debug key="debug" />
          </WorldView>
        )}
        <FadeOverlay ref={state.ref("fadeEl")} />
        <WorldWorker />
        <WorldMenu />
        <WorldSpeech />
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
  r3f: OverrideProperties<
    RootState,
    {
      camera: THREE.PerspectiveCamera;
      gl: THREE.WebGPURenderer;
    }
  >;
  r3fStore: RootStore;
  reqAnimId: number;
  threeReady: boolean;
  timer: Timer;
  touchDevice: boolean;

  assets: AssetsType;
  gms: Geomorph.LayoutInstance[];
  gmsData: DerivedGmsData;
  gmGraph: GmGraph;
  gmRoomGraph: GmRoomGraph;
  nav: WW.TiledNavMeshResponse;
  /**
   * Ordered by first time seen in `gms`.
   * Thus `seenGmKeys.indexOf(gmKey)` provides `texId`.
   */
  seenGmKeys: StarShipGeomorphKey[];
  sheets: SheetsType;

  /** Hash of `w.assets` */
  hash: number;
  /** Hash of `w.gms` */
  gmsHash: number;
  lastHmr: number;
  /** Last time the world query succeeded */
  lastQuery: number;
  /**
   * Ideally `assets` -> `nav` -> `decor` -> `null`.
   * However, nav/decor could be triggered by HMR.
   */
  pending: Partial<Record<PendingKey, true>>;

  texFloor: TexArray;
  texCeil: TexArray;
  texObs: TexArray;
  texDecor: TexArray;
  texDoorLabel: TexArray;
  texNpcLabel: TexArray;
  texSkin: TexArray;

  b: UseStateRef<import("./NpcBubbles").State>["byKey"];
  bubble: UseStateRef<import("./NpcBubbles").State>;
  ceil: UseStateRef<import("./Ceiling").State>;
  d: UseStateRef<import("./Doors").State>["byKey"];
  debug: UseStateRef<import("./Debug").State>;
  decor: UseStateRef<import("./Decor").State>;
  door: UseStateRef<import("./Doors").State>;
  e: UseStateRef<import("./use-world-events").State>;
  floor: UseStateRef<import("./Floor").State>;
  menu: UseStateRef<import("./WorldMenu").State>;
  n: UseStateRef<import("./NPCs").State>["npc"];
  npc: UseStateRef<import("./NPCs").State>;
  obs: UseStateRef<import("./Obstacles").State>;
  rings: UseStateRef<import("./NpcRings").State>;
  shadows: UseStateRef<import("./NpcShadows").State>;
  speech: UseStateRef<import("./WorldSpeech").State>;
  view: UseStateRef<import("./WorldView").State>;
  wall: UseStateRef<import("./Walls").State>;
  worker: UseStateRef<import("./WorldWorker").State>;

  helper: typeof helper;

  rootEl: HTMLDivElement;
  fadeEl: HTMLDivElement | null;

  setCanvasFade(on: boolean): void;
  setDisabled(nextDisabled?: boolean): void;
  setNextPending(next: Partial<Record<PendingKey, boolean>>): void;
  setupDevAssetsSync(): () => void;
  getGmKeyTexId(gmKey: StarShipGeomorphKey): number;
  getTheme(): import("../assets.schema").WorldTheme;
  /** Either playground map or mentions a playground hull-symbol */
  isPlaygroundMap(): boolean;
  isReady(connectionKey?: string): boolean;
  loadDecorImages(): Promise<HTMLImageElement[]>;
  onTick(): void;
  setupDraftAssetsSync(): () => void;
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

import.meta.hot?.on("vite:beforeUpdate", (foo) => {
  const updatedThisFile = foo.updates.some((payload) => payload.path.endsWith("World.tsx"));
  if (import.meta.hot && updatedThisFile) {
    // used to ignore stale queryFn and trigger fresh one
    import.meta.hot.data.__JUST_HMR_WORLD__ = true;
  }
});

type PendingKey = "assets" | "decor" | "nav" | "obstacles" | "skins";

function FadeOverlay(props: { ref: React.RefCallback<HTMLDivElement> }) {
  return (
    <div
      ref={props.ref}
      // initially faded
      className="absolute inset-0 z-5 bg-zinc-900 pointer-events-none transition-opacity opacity-100 duration-100"
    />
  );
}
