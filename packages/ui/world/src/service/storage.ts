import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import type { LocalStore } from "@npc-cli/util/local-store";
import { createLocalStore, listLocalStorageKeys, removeLocalStorageKeys } from "@npc-cli/util/local-store";
import type { CameraModeType } from "../components/CameraControls";
import { defaultBrightness, defaultPlayerKey, type ItemKind, inventoryConfig } from "../const.env";
import type { ExtraFxKey } from "./extra-fx";
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
  cameraMode: null | CameraModeType;
  cameraInitial: null | PersistedCamera;
  /** Whether the camera follows the player — an option of either `cameraMode` */
  follow: boolean;
  postProcessing: boolean;
  /** Whether the channels are parted over the finished frame — see `service/rgb-shift` */
  rgbShift: boolean;
  /** Whether an extra fx ends the post pass, see `service/extra-fx` */
  extraFxEnabled: boolean;
  extraFxKey: ExtraFxKey;
  /** Whether the post pass fades the world beyond the player — see `service/post-processing` */
  /** How much of the world is shown by ROOM — see `service/fade-rooms` */
  fadeRoomsMode: FadeRoomsMode;
  /** debug: whether the rooms in view are ringed over the finished frame — see `service/room-outline` */
  fadeRoomOutlines: boolean;
  /** Whether the post pass borders the npcs — see `service/npc-outline` */
  npcOutline: boolean;
  /** Whether being lit shows at all: the npc themself, and the room they stand in */
  litNpcsEnabled: boolean;
  /** Toggle doors via picking e.g. switches */
  pickOpenDoors: boolean;
  /** Whether doors are drawn during object-picking at all — see `Debug`'s `pickDoors` */
  pickDoors: boolean;
  /** Whether we are decorating — see `Debug`'s `decorShown` */
  decorShown: boolean;
  /** Whether a right click or long press opens a menu on an npc, decor or door — see `Debug`'s `contextMenu` */
  contextMenu: boolean;
  /** Whether the map's spots are drawn — see `Debug`'s `spotsShown` */
  spotsShown: boolean;
  /** Whether the player's bar shows debug controls, e.g. forcing a shot's outcome — see `Debug`'s `hudDebug` */
  hudDebug: boolean;
  /** Game time per real second, `0` to `2` — see `GameTime.setScale` */
  timeScale: number;
  /** Whether the menu shows its time scale slider, else only its number */
  timeSliderOpen: boolean;
  /** What the player's bubble set of their breathing, over its defaults */
  breathTune: Partial<import("../const.npc").BreathTune>;
  gmGraphsFilter: "gm" | "room";
  menuY: number;
  menuWidth: number;
  menuHeight: number;
  speechY: number;
  /** How far the player's bar was dragged up from its place, as a `y` offset: never positive */
  hudY: number;
  speechWidth: null | number;
  speechHeight: null | number;
  /** By npcKey, so it goes with them from map to map — see `w.e.carried` */
  carried: Record<string, Carried>;
  /**
   * The server world we were a client of — drives auto-reconnect on load. `remote` scopes the
   * search: a same-page parent never resolves to another tab's world of the same key, nor
   * vice versa (worldKeys are only unique within a page)
   */
  netParent: null | { worldKey: string; remote: boolean };
};

const defaultWorldSettings: WorldSettings = {
  cameraMode: "embodied",
  cameraInitial: null,
  follow: isTouchDevice(),
  postProcessing: true,
  rgbShift: true,
  extraFxEnabled: false,
  extraFxKey: "dot-screen",
  fadeRoomsMode: "sight",
  fadeRoomOutlines: false,
  npcOutline: isTouchDevice() === false,
  litNpcsEnabled: true,
  pickOpenDoors: true,
  pickDoors: false,
  decorShown: false,
  contextMenu: true,
  spotsShown: false,
  hudDebug: false,
  timeScale: 1,
  timeSliderOpen: true,
  breathTune: {},
  gmGraphsFilter: "room",
  menuY: 40,
  menuWidth: 288,
  menuHeight: 288,
  speechY: 40,
  hudY: 0,
  speechWidth: null,
  speechHeight: null,
  // the player sets out with psi and a phaser
  carried: { [defaultPlayerKey]: { items: [createItemDef("phaser", "phaser-0")], psi: true } },
  netParent: null,
};

/** What an npc has: the defs of the decor they took, and psi if granted */
export type Carried = { items: Geomorph.DecorDef[]; psi?: true };

/** An item as carried: a quad stood its height off the floor, or a point flat on it */
export function createItemDef(name: ItemKind, key: string, extra?: Meta): Geomorph.DecorDef {
  const h = inventoryConfig.height[name];
  const meta = { item: name, h, shown: true, ...extra };
  return h === undefined
    ? { type: "point", key, img: name, x: 0, y: 0, scale: inventoryConfig.pointScale, meta }
    : { type: "quad", key, img: name, transform: [1, 0, 0, 1, 0, 0], meta };
}

/** What we left behind on some map, restored on returning to it */
export type WorldMapState = {
  npcs: null | PersistedNpcs;
  /**
   * The `gdKey`s of the locked doors. It is exhaustive, so an absent door is unlocked
   * — even one whose `meta.locked` says otherwise. `null` means never saved.
   */
  doorLocks: null | string[];
  /** The `gdKey`s of the held doors. `null` means never saved */
  doorHolds: null | string[];
  /** By `gdKey`, each door's `auto` and `proximity` where they differ from the map's. `null` means never saved */
  doorFlags: null | Record<string, DoorFlags>;
  /** Runtime decor defs, replayed via `w.decor.create` on restore. `null` means never saved */
  decor: null | Geomorph.DecorDef[];
  /** Keys of the layout items already made runtime decor, so one taken is not made again — see `w.e.seedItems` */
  seeded: null | string[];
};

const defaultWorldMapState: WorldMapState = {
  npcs: null,
  doorLocks: null,
  doorHolds: null,
  doorFlags: null,
  decor: null,
  seeded: null,
};

/** A door's own `auto` and `proximity`, set apart from its map's */
export type DoorFlags = { auto?: boolean; proximity?: boolean };

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
  /** The doors of this map they hold keys to */
  access?: string[];
};

/** How the camera frames the floor: its vertical fov, and the metres of floor seen at each zoom stop */
export type CameraView = { fov: number; nearView: number; farView: number };

/** Shared by every World on the site, under one key: the menu's light slider, and the camera's framing */
export type SiteSettings = {
  brightness: number;
  /** The npcs' own, by theme key, where the menu's slider has overridden the theme's — see `NPCs`' `dimNode` */
  npcBrightnessByTheme: Record<string, number>;
  /** Which of the two the menu's one slider last adjusted */
  lightKey: "world" | "npc";
  /** `null` for the defaults, which depend on the device — see `getDefaultCameraView` in `service/camera-view` */
  camera: null | CameraView;
  /** How same-page joins connect: a `MessageChannel` skips WebRTC — see `docs/web-rtc-worlds.md` */
  netTransport: import("./net-signaling").NetTransport;
};

const defaultSiteSettings: SiteSettings = {
  brightness: defaultBrightness,
  npcBrightnessByTheme: {},
  lightKey: "world",
  camera: null,
  netTransport: "WebRTC",
};

let siteStore: undefined | LocalStore<SiteSettings>;

export function getSiteStore() {
  return (siteStore ??= createLocalStore("site", defaultSiteSettings));
}

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
