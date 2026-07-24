export const precision = 4;

/** Size of starship geomorphs grid side in meters */
export const geomorphGridMeters = 1.5;

/**
 * Convert Starship Geomorph units (sgu) into world coordinates (meters).
 * e.g. 1 tile is 60 sgu, which becomes 1.5 meters
 */
export const sguToWorldScale = (1 / 60) * geomorphGridMeters;
/**
 * Convert world coordinates (meters) into Starship Geomorph units (sgu).
 * e.g. 1 tile is 1.5 meters, which becomes 60 sgu
 */
export const worldToSguScale = 1 / sguToWorldScale;

export const decorPointDefaultRadius = (5 + 2) * sguToWorldScale;
export const doorSwitchHeight = 1.2;

export const wallOutsetSgu = 10;

export const obstacleOutset = 8 * sguToWorldScale;
/**
 * Walls with any of these tags will not be merged with adjacent walls
 * - `y` (numeric) Height of base off the floor
 * - `h` (numeric) Height of wall
 * - `broad` (true) Not thin e.g. back of lifeboat
 */

export const wallOutset = wallOutsetSgu * sguToWorldScale;
export const specialWallMetaKeys = ["y", "h", "broad", "hollow"] as const;

/** Depth of doorway along line walking through door */
export const doorDepth = 20 * sguToWorldScale;
/** Depth of doorway along line walking through hull door */
export const hullDoorDepth = 40 * sguToWorldScale;
/**
 * Smaller than @see {offMeshConnectionHalfDepth}
 */
export const connectorEntranceHalfDepth = {
  hull: 0.25 + wallOutset,
  nonHull: 0.125 + wallOutset,
};

/** Unchangeable 🚧 why this value? */
export const geomorphPngRectWidth = 30.3;
/** Higher resolution floors */
export const gmFloorExtraScale = 2.5;

/** This is the width and height (even for edge geomorphs) because we use texture arrays. */
export const floorTextureDimension = Math.ceil(geomorphPngRectWidth * worldToSguScale * gmFloorExtraScale);

export const roomHitTextureScaleDown = Math.ceil(geomorphPngRectWidth * worldToSguScale) / floorTextureDimension;

/** Assumed to exist inside `assets.json` `map` lookup */
export const emptyMapKey = "empty-map";

/** Assumed to exist inside `assets.json` `map` lookup */
export const defaultMapKey = "301-only";

/** The value of @see {emptyMapKey} */
export const emptyMapDef: import("./assets.schema").AssetsMapDef = {
  key: emptyMapKey,
  gms: [],
};

export const assetsJsonChangingEvent = "assets-json-changing";
export const assetsJsonChangedEvent = "assets-json-changed";
export const mapEditSymbolSavedEvent = "map-edit:symbol-saved";

export const brightnessStorageKey = `world-brightness-value`;
export const cameraModeStorageKey = `world-camera-mode`;
export const cameraPositionStorageKey = "world-camera-position";
export const numCardinalDirectionsKey = `world-camera-cardinal-directions`;
export const fovStorageKey = `world-fov-value`;
export const defaultDesktopFov = 40;
export const defaultMobileFov = 60;
export const defaultBrightness = 2;
export const postProcessingEnabledKey = "world-post-processing-enabled";
export const roomLightEditingEnabledKey = "world-room-light-editing-enabled";
export const roomLightingEnabledKey = "world-room-lighting-enabled";
/** Prefix for the per-map lit-rooms localStorage key — actual key is `${roomLitStorageKeyPrefix}:${mapKey}` */
export const roomLitStorageKeyPrefix = "world-room-lit";
/** Per-instance cap on room count, for sizing the `roomLit` boolean array */
export const maxRoomsPerGm = 32;
export const roomLightIntensityKey = "world-room-light-intensity";
/** Default brightness of a lit room (long-press), scaling `RoomLightPostprocess.litAmount()` */
export const defaultRoomLightIntensity = 0.7;

/** Default radius of the light following a tracked npc (see `w.npc.trackNpc`) */
export const defaultTargetLightRadius = 1;
export const trackedLightRadiusKey = "world-tracked-light-radius";
/** Brightness multiplier (0..1) applied to the tracked light before combining with room lighting */
export const defaultTrackedLightIntensity = 1;
export const trackedLightIntensityKey = "world-tracked-light-intensity";
/** How far (meters) the tracked light's room-polygon clip is outset past the room's inner wall face */
export const trackedLightRoomOutset = 0.1;
/** Default magnitude of the world's ambient (unlit-area) tint — see `dimWorldColor` */
export const defaultAmbientIntensity = 0.4;
export const ambientIntensityKey = "world-ambient-intensity";
export const ambientMoodKey = "world-ambient-mood";
/**
 * When the tracked light switches rooms, a door from the room just left is still merged in (as a
 * reach-slot, plus a bit of directly-lit room around it) if within this distance (meters) of the
 * npc — e.g. two doors meeting at a right-angle corner, where the 2nd door would otherwise go
 * dark immediately (it no longer borders the new current room, and reaching its far room would
 * need two door-hops, which the tracked light doesn't support).
 */
export const nearbyDoorMergeDist = 2;
/**
 * Depth (meters) of the thin polygon merged into the tracked light's room clip around each
 * "nearby" door from the room just left (see `nearbyDoorMergeDist`) — split `±half` across the
 * door's line, so part of it reaches into that room, keeping a small part of it directly lit
 * rather than only reachable via that door's own reach-slot. Kept generous (bigger than it looks
 * like it needs to be) so it clearly overlaps both the current room's own outline and any other
 * nearby door's thin polygon (e.g. 3 doors meeting at a T) — a shallow depth can leave pieces
 * merely touching rather than overlapping, which can make `Poly.union` split them into disjoint
 * rings instead of one connected shape (`WorldView.tsx`'s `extendRoomOutlineNearDoors` falls back
 * safely if that still happens, but a bigger margin avoids needing that fallback in the first place).
 */
export const nearbyDoorMergeExtensionDepth = 1.5;

export const defaultCameraMode = "cardinal" satisfies import("./components/CameraControls").CameraModeType;
export const defaultCardinalDirectionsDesktop = 8;
export const defaultCardinalDirectionsMobile = 4;

export const defaultThemeKey = "light-theme";

export const defaultWorldTheme: import("./assets.schema").WorldTheme = {
  background: "bg-[#000]", // seeing initial flicker
  ceiling: {
    hull: { fill: "#000", stroke: "#666" },
    nonHull: { fill: "#444", stroke: "#000" },
  },
  floor: { hullFill: "#111", navStroke: "#000c", patternFill: "#222", tileStroke: "#0001" },
  walls: { color: "#000000", opacity: 0.5 },
};

export const wallHeight = 1.7;

export const MAX_GEOMORPH_INSTANCES = 8;

export const MAX_OBSTACLE_QUAD_INSTANCES = 1024;

export const MAX_OBSTACLE_SKIRT_INSTANCES = 2048;

/**
 * A decor quad is represented as a cuboid with single textured face.
 */
export const MAX_DECOR_QUAD_INSTANCES = 1024;

/** Meters */
export const npcHeight = 1.2;
export const npcScale = 0.7;

export const MAX_NPCS = 256;
export const MAX_DOOR_LABELS = 32;

/** In meters, or equivalently 2 grid squares */
export const decorGridSize = geomorphGridMeters * 2;

export const decorKeyFallback = "icon--warn";

export const gmIdGridDim = 600 * sguToWorldScale;

export const colliderHeight = 0.025;

export const idleMaxAcceleration = 4.0;
export const idleSeparatingMaxAcceleration = 0.25;
export const walkMaxAcceleration = 8.0;
export const idleAgentMaxSpeed = 0.5;
/** Separating idle npcs should not move by default */
export const idleSeparatingMaxSpeed = 0.005;
export const walkAgentMaxSpeed = 1.5;
export const runAgentMaxSpeed = 2.5;
export const walkSeparationWeight = 0.5;
export const idleSeparationWeight = 0.1; // Less pushable

export const maxAgentRadius = 0.5;

export const defaultDoorCloseMs = 3000;

export const html3DOpacityCssVar = "--html-3d-opacity";

export const lockedDoorTint = "#f44";

export const unlockedDoorTint = "#4b4";

export const fromAnimationClipKey = {
  idle: true,
  breathe: true,
  lie: true,
  run: true,
  shuffle: true,
  sit: true,
  walk: true,
};

export const defaultIdleAnimationClipKey = "breathe" satisfies import("./components/NPCs").AnimationClipKey;

export const pickOpenDoorsKey = "world-debug-pick-open-doors";

export const defaultSkinKey = "medic-0";
