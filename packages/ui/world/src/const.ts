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

/** How far a door's "inside" sensor pokes out of the doorway, each side — see `createDoorSensors` */
export const insideDoorSensorOutset = 0.1;
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

/** 20 grid units + hull walls 0.15 either side */
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

/** Vertical field of view (degrees) of the world camera, up to `cameraRefAspect` */
export const cameraFov = 30;

/** Wider than this (width / height) and the vertical fov closes — see `getCameraFov` */
export const cameraRefAspect = 1.8;

export const defaultBrightness = 2;
/** Default `w.player.key` */
export const defaultPlayerKey = "rob";
/** How many random rooms we'll try when spawning the player */
export const spawnPlayerAttempts = 10;
/** Per-instance cap on room count, for sizing the `roomLit` boolean array */
export const MAX_ROOMS_PER_GM = 32;
/** Default brightness of a lit room (long-press), scaling `RoomLightPostprocess.litAmount()` */
export const defaultRoomLightIntensity = 0.7;

/** Default radius of the light following a tracked npc (see `w.npc.trackNpc`) */
export const defaultDynamicLightRadius = 3.5;
/** Upper bound of the "npc radius" slider in `WorldMenu.tsx` — also used to size the occlusion march. */
/**
 * Side (metres) of dynamic-light super-tile.
 * The light's occupancy window is 3x3 of these recentred whenever light leaves central one.
 */
export const lightTileSize = 7.5;

export const maxDynamicLightRadius = 4.5;
/** Brightness multiplier (0..1) applied to the dynamic light before combining with room lighting */
export const defaultDynamicLightIntensity = 1;
/** Default extent (0..1) of the vignette darkening the corners of the frame */
export const defaultVignette = 0;

export const defaultAmbientIntensity = 1;

export const defaultCameraModeDesktop = "cardinal" satisfies import("./components/CameraControls").CameraModeType;
export const defaultCameraModeMobile = "free" satisfies import("./components/CameraControls").CameraModeType;
export const defaultCardinalDirectionsDesktop = 4;
export const defaultCardinalDirectionsMobile = 4;

/** Camera rotate speed: touch drags are much shorter than mouse drags, so they get more per-pixel */
export const rotateSpeedDesktop = 1;
export const rotateSpeedMobile = 1.75;
/** Camera zoom speed: applied as an exponent to the pinch spread ratio (and to the wheel scale) */
export const zoomSpeedDesktop = 0.3;
export const zoomSpeedMobile = 0.8;

export const defaultWorldTheme: import("./assets.schema").WorldTheme = {
  background: "bg-[#000]", // seeing initial flicker
  ceiling: {
    hull: { fill: "#000", stroke: "#666" },
    nonHull: { fill: "#444", stroke: "#000" },
  },
  floor: {
    hullFill: "#111",
    navStroke: "#000c",
    patternFill: "#222",
    tileStroke: "#0001",
  },
  lights: {
    ambientIntensity: defaultAmbientIntensity,
  },
  obstacles: {
    brightness: 1,
  },
  doors: {
    brightness: 1,
  },
  walls: { color: "#000000", opacity: 0.5 },
};

export const wallHeight = 1.7;

export const floorFadeDelayMs = 260;

export const MAX_GEOMORPH_INSTANCES = 8;

export const MAX_OBSTACLE_QUAD_INSTANCES = 1024;

export const MAX_OBSTACLE_SKIRT_INSTANCES = 2048;

/**
 * A decor quad is represented as a cuboid with single textured face.
 */
export const MAX_DECOR_QUAD_INSTANCES = 1024;

export const npcScale = 0.7;

export const MAX_NPCS = 256;
export const MAX_DOOR_LABELS = 32;

/** In meters, or equivalently 2 grid squares */
export const decorGridSize = geomorphGridMeters * 2;

export const decorKeyFallback = "icon--warn";

/** 15 (meters) */
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

/**
 * NPC tuning: `npcfg.dist` in meters, `npcfg.time` in seconds.
 */
export const npcfg = {
  dist: {
    /** Arrival radius, per `running` and whether we slow down beforehand */
    arrive: { walk: 0.15, run: 0.025 },
    /** Arrival radius when gliding through, i.e. `arrive` is false */
    glide: { walk: 0.4, run: 0.8 },
    /** Arrival radius floor, else a zero-distance move never arrives */
    arriveMin: 0.02,
    /** Arrival radius is also capped at this fraction of `npc.last.targetDistance` */
    arriveFraction: 0.4,
    /** Manhattan distance below which a move uses `shuffle` rather than `walk` */
    shuffleTarget: 0.25,
    /** Within this of the closest reachable point we look rather than walk */
    blockedLook: 0.3,
    /** Look before teleporting onto a doable this close by */
    doableLook: 1.5,
    /** Below this much movement per frame an npc counts as motionless */
    stuckEpsilon: 0.002,
    /** Height of an npc */
    height: 1.2,
    /** Sizes the crowd */
    maxAgentRadius: 0.5,
  },
  time: {
    /** Grace after a move starts, before stuck detection applies */
    stuckGrace: 0.5,
    /** How long an npc must stay motionless to count as stuck */
    stuckDuration: 0.4,
    /** Minimum look duration before teleporting onto a nearby doable */
    look: 0.5,
  },
} as const;

export const defaultDoorCloseMs = 3000;

export const html3DOpacityCssVar = "--html-3d-opacity";

/** How solid a door looks. Dithered rather than blended — see `Doors`' `alphaHash` */
export const defaultDoorOpacity = 0.8;

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

/** Fallback for @see {fadeSecs} */
export const defaultFadeSecs = 0.3;

/**
 * Cross-fade seconds `fadeSecs[src][dst]`, from one animation clip into another.
 * A missing destination falls back to @see {defaultFadeSecs}.
 */
export const fadeSecs: Record<
  keyof typeof fromAnimationClipKey,
  Partial<Record<keyof typeof fromAnimationClipKey, number>>
> = {
  breathe: { shuffle: 0.15 },
  idle: { shuffle: 0.15 },
  lie: {},
  run: {},
  // brief, so it must fade quickly to be seen at all
  shuffle: { breathe: 0.15, idle: 0.15 },
  sit: {},
  walk: {},
};

export const defaultSkinKey = "medic-0";
