import type { LocalStore } from "@npc-cli/util/local-store";
import { createLocalStore, listLocalStorageKeys, removeLocalStorageKeys } from "@npc-cli/util/local-store";
import type { CameraModeType } from "../components/CameraControls";
import { defaultBrightness } from "../const";
import type { DemoPostFxKey } from "./demo-post-process";
import type { FadeRoomsMode } from "./fade-rooms";

/**
 * Everything a World persists lives under two keys, both scoped by `worldKey`
 * (`world-0`, `world-1`, …) so instances don't overwrite each other:
 *
 * - `world:<worldKey>` — settings
 * - `world:<worldKey>:map:<mapKey>` — what we left behind on some map
 *
 * `worldKey` is used rather than the pane's `w.id`, which is a `ui-<uuid>` remade
 * whenever the layout is rebuilt.
 */
const worldPrefix = "world:";

const worldKeyOf = (worldKey: string) => `${worldPrefix}${worldKey}`;
const worldMapKeyOf = (worldKey: string, mapKey: string) => `${worldPrefix}${worldKey}:map:${mapKey}`;

/** A camera reading, as restored on load — see `WorldView` `initial` */
export type PersistedCamera = {
  azimuthal: number;
  polar: number;
  position: { x: number; y: number; z: number };
};

/** `null` means "no preference yet", where the default depends on the device */
export type WorldSettings = {
  brightness: number;
  cameraMode: null | CameraModeType;
  cameraInitial: null | PersistedCamera;
  postProcessing: boolean;
  /** Which stock effect runs after the backdrop composite — see `service/demo-post-process` */
  demoPostFx: DemoPostFxKey;
  /** Whether the post pass fades the world beyond the player — see `service/post-processing` */
  /** How much of the world is shown by ROOM — see `service/fade-rooms` */
  fadeRoomsMode: FadeRoomsMode;
  /** Whether the rooms in view are outlined over the finished frame — see `service/fade-rooms` */
  fadeRoomOutlines: boolean;
  /** Whether rooms, doorways and floor panels wear a soft dark edge — see `service/texture` */
  floorShading: boolean;
  /** Whether the post pass borders the npcs — see `service/npc-outline` */
  npcOutline: boolean;
  /** Whether being lit shows at all: the npc themself, and the room they stand in */
  litNpcsEnabled: boolean;
  /** Toggle doors via picking e.g. switches */
  pickOpenDoors: boolean;
  /** Whether doors are drawn during object-picking at all — see `Debug`'s `pickDoors` */
  pickDoors: boolean;
  gmGraphsFilter: "gm" | "room";
  menuY: number;
  menuWidth: number;
  menuHeight: number;
  /** The one unfolded section, e.g. `debug` — the menu is a concertina */
  menuSection: null | string;
  speechY: number;
  speechWidth: null | number;
  speechHeight: null | number;
  /**
   * The server world we were a client of — drives auto-reconnect on load. `remote` scopes the
   * search: a same-page parent never resolves to another tab's world of the same key, nor
   * vice versa (worldKeys are only unique within a page)
   */
  netParent: null | { worldKey: string; remote: boolean };
};

const defaultWorldSettings: WorldSettings = {
  brightness: defaultBrightness,
  cameraMode: "free",
  cameraInitial: null,
  postProcessing: true,
  demoPostFx: "none",
  fadeRoomsMode: "qa",
  fadeRoomOutlines: false,
  floorShading: true,
  npcOutline: false,
  litNpcsEnabled: true,
  pickOpenDoors: true,
  pickDoors: false,
  gmGraphsFilter: "room",
  menuY: 40,
  menuWidth: 288,
  menuHeight: 288,
  menuSection: null,
  speechY: 40,
  speechWidth: null,
  speechHeight: null,
  netParent: null,
};

/** What we left behind on some map, restored on returning to it */
export type WorldMapState = {
  npcs: null | PersistedNpcs;
  /**
   * The `gdKey`s of the locked doors. It is exhaustive, so an absent door is unlocked
   * — even one whose `meta.locked` says otherwise. `null` means never saved.
   */
  doorLocks: null | string[];
  /** Runtime decor defs, replayed via `w.decor.create` on restore. `null` means never saved */
  decor: null | Geomorph.DecorDef[];
};

const defaultWorldMapState: WorldMapState = {
  npcs: null,
  doorLocks: null,
  decor: null,
};

/** The npcs of some map, as left by the previous session */
export type PersistedNpcs = {
  /** Which of `npcs` was the player; `null` if there wasn't one */
  playerKey: null | string;
  npcs: PersistedNpc[];
};

export type PersistedNpc = {
  key: string;
  at: { x: number; y: number };
  /** Radians, CW from north viewed from above */
  angle: number;
  skinKey: string;
  /** Set when the npc was doing something e.g. sitting */
  decorKey?: string;
  /** Set whilst they were lit up — absent in an older save, which restores nobody lit */
  lit?: boolean;
};

const worldStores = {} as Record<string, LocalStore<WorldSettings>>;
const worldMapStores = {} as Record<string, LocalStore<WorldMapState>>;

export function getWorldStore(worldKey: string) {
  return (worldStores[worldKey] ??= createLocalStore(worldKeyOf(worldKey), defaultWorldSettings));
}

export function getWorldMapStore(worldKey: string, mapKey: string) {
  const key = worldMapKeyOf(worldKey, mapKey);
  return (worldMapStores[key] ??= createLocalStore(key, defaultWorldMapState));
}

/** Flush both stores' pending writes, e.g. on `beforeunload` */
export function flushWorldStores(worldKey: string, mapKey: string) {
  getWorldStore(worldKey).flush();
  getWorldMapStore(worldKey, mapKey).flush();
}

/**
 * Other worlds with something saved for `mapKey`, so we can restore from one of them
 * — see `w.e.restoreFromWorld`.
 */
export function listWorldKeysWithMap(mapKey: string, exceptWorldKey: string): string[] {
  const suffix = `:map:${mapKey}`;
  return listLocalStorageKeys(worldPrefix)
    .flatMap((key) => (key.endsWith(suffix) ? key.slice(worldPrefix.length, -suffix.length) : []))
    .filter((worldKey) => worldKey !== exceptWorldKey && worldKey !== "")
    .sort();
}

/**
 * The `world-*` keys this module replaced — a key per setting, and per-map data
 * shared by every instance. Swept once per page load, rather than migrated.
 */
export function removeLegacyWorldKeys() {
  removeLocalStorageKeys((key) => key.startsWith("world-"));
}

removeLegacyWorldKeys();
