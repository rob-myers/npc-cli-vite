import type { StarShipGeomorphKey } from "@npc-cli/media/starship-symbol";
import { isPlaygroundMapKey, isPlaygroundSymbolKey } from "@npc-cli/ui__map-edit/editor.schema";
import { devMessageFromServer } from "@npc-cli/ui__map-edit/map-node-api";
import { UiContext } from "@npc-cli/ui-sdk/UiContext";
import { Broadcaster, cn, type UseStateRef, useBeforeUnloadOrVisibilityChange, useStateRef } from "@npc-cli/util";
import { fetchParsed, getDevCacheBustQueryParam } from "@npc-cli/util/fetch-parsed";
import { isTouchDevice, loadImage } from "@npc-cli/util/legacy/dom";
import { debug, entries, hashJson } from "@npc-cli/util/legacy/generic";
import type { RootState, RootStore } from "@react-three/fiber";
import { extend } from "@react-three/fiber";
import { useQuery } from "@tanstack/react-query";
import debounce from "debounce";
import { useContext, useEffect } from "react";
import * as THREE from "three/webgpu";
import { Timer } from "three-stdlib";
import type { OverrideProperties } from "type-fest";
import { AssetsSchema, type AssetsType, SheetsSchema, type SheetsType } from "../assets.schema";
import {
  assetsJsonChangedEvent,
  assetsJsonChangingEvent,
  defaultWorldTheme,
  emptyMapDef,
  floorTextureDimension,
  MAX_DOOR_LABELS,
  MAX_NPCS,
  mapEditSymbolSavedEvent,
  roomLabelTexOpts,
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
import { flushWorldStores, getWorldStore } from "../service/storage";
import { TexArray } from "../service/tex-array";
import { cancelClearWorldFlags, scheduleClearWorldFlags } from "../service/world-flags";
import Ceiling from "./Ceiling";
import { Debug } from "./Debug";
import Decor from "./Decor";
import Doors from "./Doors";
import Floor from "./Floor";
import NPCs from "./NPCs";
import NpcRings from "./NpcRings";
import NpcShadows from "./NpcShadows";
import Obstacles from "./Obstacles";
import RoomLabels from "./RoomLabels";
import useWorldEvents from "./use-world-events";
import useWorldNet from "./use-world-net";
import useWorldPlayer from "./use-world-player";
import Walls from "./Walls";
import { WorldMenu } from "./WorldMenu";
import { WorldSpeech } from "./WorldSpeech";
import { WorldView } from "./WorldView";
import WorldWorker from "./WorldWorker";
import { WorldContext } from "./world-context";
import "../world.css";

export default function World({ meta }: { meta: WorldUiMeta }) {
  const { uiStoreApi } = useContext(UiContext);

  const state = useStateRef(
    (): State => ({
      id: meta.id,
      key: meta.worldKey,
      client: false,
      disabled: meta.disabled,
      mapKey: meta.mapKey,
      themeKey: "dark-theme",
      worldQueryPrefix: ["world", meta.worldKey],

      brightness: getWorldStore(meta.worldKey).read().brightness,

      events: new Broadcaster(),
      reqAnimId: -1,
      threeReady: false,
      timer: new Timer(),
      touchDevice,

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
        srgb: true, // drawn in display colours e.g. the theme's `patternFill`
      }),
      texCeil: new TexArray({
        ctKey: "ceil-tex",
        numTextures: 2, // can change
        width: floorTextureDimension,
        height: floorTextureDimension,
        anisotropy: touchDevice ? undefined : 4,
      }),
      texObs: new TexArray({
        ctKey: "obs-tex",
        numTextures: 1, // from sheets.symbolSheetDims.length
        width: 1,
        height: 1,
        anisotropy: touchDevice ? undefined : 4,
      }),
      texDecor: new TexArray({ ctKey: "decor-tex", numTextures: 1, width: 64, height: 64, anisotropy: 4 }),
      texDoorLabel: new TexArray({
        ctKey: "door-labels",
        width: 256,
        height: 512,
        numTextures: MAX_DOOR_LABELS,
        srgb: true, // likewise colour: the panel reads as it was drawn
      }),
      texNpcLabel: new TexArray({ ctKey: "npc-labels", width: 256, height: 64, numTextures: MAX_NPCS }),
      texRoomLabel: new TexArray(roomLabelTexOpts),
      texSkin: new TexArray({ ctKey: "npc-skins", width: 256, height: 256, numTextures: MAX_NPCS }),

      assets: null as any,
      sheets: null as any,
      gms: [],
      seenGmKeys: [],
      gmsData: new DerivedGmsData(),
      gmGraph: new GmGraph([]),
      gmRoomGraph: new GmRoomGraph(),
      nav: emptyTiledNavmeshResponse,
      // gltf is pending from the outset, else the first map could settle without npcs
      pending: { gltf: true },
      settledMapKey: null,
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
      player: null as any,
      floor: null as any,
      menu: {} as State["menu"],
      net: null as any,
      npc: null as any,
      n: null as any,
      obs: null as any,
      rings: null as any,
      roomLabels: null as any,
      shadows: null as any,
      speech: null as any,
      view: null as any,
      wall: null as any,
      worker: { worker: { postMessage() {} } } as any,

      helper,

      worldGroup: null,
      fold: { amount: 0, animId: 0, resolve: null }, // flat until the first floor is up
      rootEl: null as any,

      /** Announce the map once its pending keys stop changing */
      mapSettled: debounce(() => {
        if (state.settledMapKey === state.mapKey || Object.keys(state.pending).length > 0) {
          return;
        }
        state.settledMapKey = state.mapKey;
        state.events.next({ key: "map-settled" });
      }, settledMs),

      /** Everything but the floor folds onto it, and rises again once the floor is back */
      foldTo(amount, ms = worldFoldMs) {
        return new Promise<void>((resolve) => {
          const { fold } = state;
          // a fold replaced mid-flight still settles, else its awaiter would wait forever
          cancelAnimationFrame(fold.animId);
          fold.resolve?.();
          fold.resolve = resolve;

          const from = fold.amount;
          const startMs = performance.now();
          const step = () => {
            const t = ms > 0 ? Math.min(1, (performance.now() - startMs) / ms) : 1;
            state.setWorldFold(from + (amount - from) * t);
            if (t === 1) {
              fold.animId = 0;
              fold.resolve = null;
              return resolve();
            }
            fold.animId = requestAnimationFrame(step);
          };
          step();
        });
      },
      getGmKeyTexId(gmKey: StarShipGeomorphKey) {
        return this.seenGmKeys.indexOf(gmKey);
      },
      getTheme() {
        return state.assets?.theme?.[state.themeKey] ?? defaultWorldTheme;
      },
      getTrimCount() {
        return state.gmsData.count.wall + state.gmsData.count.door + state.gmsData.count.window;
      },
      isPlaygroundMap() {
        if (isPlaygroundMapKey(state.mapKey)) return true;
        const mapDef = state.assets.map[state.mapKey] ?? emptyMapDef;
        return mapDef.gms.some(({ gmKey }) => isPlaygroundSymbolKey(gmKey));
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
        state.net?.onTick(delta); // mirrors move before the npc tick animates them
        state.npc.onTick(delta);
        state.speech?.onTick(delta);
        state.view.followPlayer(delta);
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
        state.mapSettled();
      },
      setWorldFold(amount) {
        state.fold.amount = amount;
        if (state.worldGroup !== null) {
          // never exactly 0: a singular instance matrix takes the normals with it
          state.worldGroup.scale.y = Math.max(minWorldFold, amount);
        }
        // npcs are outside the fold, keeping their height — they fade to black by this instead,
        // as do their shadows and rings
        if (state.view?.foldNode !== undefined) {
          state.view.foldNode.value = amount;
        }
        state.r3f?.invalidate();
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
            await queryClientApi.queryClient.invalidateQueries({ queryKey: ["sheets"] });
            // ensure `state.sheets` reflects the refetch before dependants redraw from it
            const freshSheets = queryClientApi.queryClient.getQueryData<SheetsType>(["sheets"]);
            if (freshSheets) state.sheets = freshSheets;

            queryClientApi.queryClient.invalidateQueries({ queryKey: ["decor-setup"] });

            if (state.door) {
              state.door.drawDoorTextures();
              state.door.sendDataToGpu();
              state.door.update();
            }
          }],
          [devMessageFromServer.skinSheetsRebuilding, () => {
            state.setNextPending({ skins: true });
          }],
          [devMessageFromServer.skinSheetsRebuilt, async () => {
            debug("[World] skin sheets rebuilt: refetching");
            // await pause(100);
            await queryClientApi.queryClient.invalidateQueries({ queryKey: ["sheets"] });
            queryClientApi.queryClient.invalidateQueries({ queryKey: ["skins-and-gltf"] });
          }],
          [devMessageFromServer.skinSvgsChanged, async () => {
            debug("[World] skin svgs changed");
            await queryClientApi.queryClient.invalidateQueries({ queryKey: ["sheets"] });
            queryClientApi.queryClient.invalidateQueries({ queryKey: ["skins-and-gltf"] });
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

  useEffect(() => {
    queryClientApi.set([meta.worldKey], state);
    cancelClearWorldFlags(meta.worldKey); // an HMR bounce keeps the veil/fold flags
    // `rootEl` lands via ref AFTER the first render, and a runtime-added world in PROD gets no
    // other re-render (the shared queries answer from cache, synchronously) — without this,
    // `state.rootEl && <WorldView/>` never mounts and the pane sits blank
    state.update();
    return () => {
      queryClientApi.remove([meta.worldKey]);
      // deferred, so only a REAL pane removal clears — a re-added world must arrive flat,
      // behind the veil, rather than flashing unfolded before the bootstrap
      scheduleClearWorldFlags(meta.worldKey);
    };
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
      // a pure fetch, identical for every world — one query, not one per instance
      queryKey: ["sheets"],
      async queryFn() {
        return await fetchParsed(`/sheets.json${getDevCacheBustQueryParam()}`, SheetsSchema);
      },
    }).data ?? state.sheets; // spritesheets: decor, skins, symbols (obstacles)

  useWorldEvents(state);
  useWorldPlayer(state);
  useWorldNet(state);

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

      if (state.hash === 0) {
        // first load only
        state.e.onChangeTheme();
      }

      state.hash = hashJson(state.assets);
      state.gmsHash = hashJson(state.gms);

      state.view.roomSlots.ensure(state.gms, state.gmsData, state.gmsHash);

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
    state.player?.persist();
    flushWorldStores(state.key, state.mapKey); // else a debounced write could be lost
  });

  return (
    <WorldContext.Provider value={state}>
      <div ref={state.ref("rootEl")} className="relative size-full">
        {state.rootEl && (
          <WorldView
            className={
              state.assets &&
              // `world-background`: the stripes that can show through the floor, and the black
              // over them whilst a map loads — see `main.css`
              cn(state.getTheme().background, "world-background")
            }
          >
            <ambientLight intensity={ambientLightIntensity} color="#fff" />
            <Floor key="floor" />
            {/* folded */}
            <group ref={state.ref("worldGroup")}>
              <Ceiling key="ceiling" />
              <Walls key="walls" />
              <Doors key="doors" />
              <Obstacles key="obstacles" />
              <Decor key="decor" />
              <NpcShadows key="npc-shadows" />
              <RoomLabels key="room-labels" />
              <NpcRings key="npc-rings" />
              <Debug key="debug" />
            </group>
            <NPCs key="npcs" />
          </WorldView>
        )}
        <WorldWorker />
        {state.view && <WorldMenu />}
        <WorldSpeech />
      </div>
    </WorldContext.Provider>
  );
}

export type State = {
  id: string;
  key: WorldUiMeta["worldKey"];
  /** `w.net.isClient()` as a field — kept in sync by `use-world-net`'s `setPhase`/`teardown` */
  client: boolean;
  disabled: boolean;
  mapKey: string;
  readonly themeKey: "dark-theme";
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
  texRoomLabel: TexArray;
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
  player: UseStateRef<import("./use-world-player").State>;
  floor: UseStateRef<import("./Floor").State>;
  menu: UseStateRef<import("./WorldMenu").State>;
  n: UseStateRef<import("./NPCs").State>["npc"];
  net: UseStateRef<import("./use-world-net").State>;
  npc: UseStateRef<import("./NPCs").State>;
  obs: UseStateRef<import("./Obstacles").State>;
  rings: UseStateRef<import("./NpcRings").State>;
  shadows: UseStateRef<import("./NpcShadows").State>;
  roomLabels: UseStateRef<import("./RoomLabels").State>;
  speech: UseStateRef<import("./WorldSpeech").State>;
  view: UseStateRef<import("./WorldView").State>;
  wall: UseStateRef<import("./Walls").State>;
  worker: UseStateRef<import("./WorldWorker").State>;

  helper: typeof helper;

  rootEl: HTMLDivElement;
  /** Everything but the lights and the floor, so it can fold flat whilst a map changes */
  worldGroup: null | THREE.Group;
  fold: {
    /** `0` flat, `1` full height */
    amount: number;
    animId: number;
    resolve: null | (() => void);
  };

  /** The map we last announced via "map-settled" */
  settledMapKey: null | string;

  foldTo(amount: number, ms?: number): Promise<void>;
  getGmKeyTexId(gmKey: StarShipGeomorphKey): number;
  getTheme(): import("../assets.schema").WorldTheme;
  /** One band per wall segment, per door, and per segment of a window's outline */
  getTrimCount(): number;
  /** Either playground map or mentions a playground hull-symbol */
  isPlaygroundMap(): boolean;
  isReady(connectionKey?: string): boolean;
  loadDecorImages(): Promise<HTMLImageElement[]>;
  mapSettled: () => void;
  onTick(): void;
  setupDevAssetsSync(): () => void;
  setupDraftAssetsSync(): () => void;
  setDisabled(nextDisabled?: boolean): void;
  setNextPending(next: Partial<Record<PendingKey, boolean>>): void;
  setWorldFold(amount: number): void;
  stopTick(): void;
};

extend({
  MeshStandardNodeMaterial: THREE.MeshStandardNodeMaterial,
});

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

/** How long the pending keys must stop changing before "map-settled" */
const settledMs = 500;

/**
 * Flat, but not so flat that everything lands on the floor plane: at a few thousandths the
 * ceiling, obstacle quads and decor all sit within a millimetre of it and z-fight. A few
 * hundredths still reads as flat whilst leaving them centimetres apart — and keeps the
 * instance matrices non-singular, which a true 0 would not.
 */
const minWorldFold = 0.03;
/** How long the world takes to fold flat, or to rise again */
const worldFoldMs = 400;

const touchDevice = isTouchDevice();

type PendingKey = "assets" | "ceiling" | "decor" | "floor" | "gltf" | "nav" | "obstacles" | "skins";

/**
 * Cancel MeshStandardMaterial 1/π factor.
 * https://github.com/mrdoob/three.js/issues/26668
 */
const ambientLightIntensity = Math.PI;
