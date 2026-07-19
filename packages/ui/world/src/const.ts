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
export const numCardinalDirectionsKey = `world-camera-cardinal-directions`;
export const fovStorageKey = `world-fov-value`;
export const defaultFov = 60;
export const defaultBrightness = 2;
export const showDebugLightOutlineKey = "world-show-debug-light-outlline";
export const postProcessingEnabledKey = "world-post-processing-enabled";
export const lightEditingEnabledKey = "world-light-editing-enabled";
export const lightsEnabledKey = "world-lights-enabled";
/** Radius a long-pressed new light starts at before it grows */
export const lightSizingStartRadius = 0.5;
export const defaultTargetLightRadius = 1;
/** Time (ms) for a long-pressed new light to grow from `lightSizingStartRadius` to `lightSizingMaxRadius` */
export const lightSizingGrowDurationMs = 2500;
/** Cap for a long-pressed new light's radius while growing */
export const lightSizingMaxRadius = 6;
/** How far (meters) a light's room-polygon clip is outset past the room's inner wall face */
export const lightRoomOutset = 0.1;
/** Duration (ms) of each half (shrink, then grow) of the tracked light's radius-pulse transition across a room-poly swap */
export const lightRoomFadeMs = 150;
/** Radius the tracked light shrinks to (close around the npc) mid-transition, before growing back */
export const lightRoomTransitionRadius = 0.5;

export const defaultCameraModeDesktop = "free" satisfies import("./components/CameraControls").CameraModeType;
export const defaultCameraModeMobile = "cardinal" satisfies import("./components/CameraControls").CameraModeType;

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

export const MAX_GEOMORPH_INSTANCES = 64;

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
/** Static, right-click-managed post-processing lights (excludes the 1 tracked light) */
export const MAX_POSTPROCESS_LIGHTS = 32;

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
