import { isTouchDevice } from "@npc-cli/util/legacy/dom";

/**
 * The world's constants, bar the npcs' tuning — that is `const.npc.ts`, split off so editing it
 * does not rebuild the world: `World.tsx` refetches on its own HMR, and every importer of THIS
 * file (its hooks included) makes it one
 */

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
export const cameraFov = 50;

/** Wider than this (width / height) and the vertical fov closes — see `getCameraFov` */
export const cameraRefAspect = 1.8;

export const defaultBrightness = 1;

/** How much of their skin an npc keeps, so the player's light reads as light ON them */
export const defaultNpcBrightness = 0.25;

export const defaultCameraMinDistance = isTouchDevice() ? 4 : 8;

/** How far out the camera's outer zoom stop sits, in metres */
export const defaultCameraMaxDistance = isTouchDevice() ? 12 : 14;
/** Default `w.player.key` */
export const defaultPlayerKey = "rob";
/** How many random rooms we'll try when spawning the player */
export const spawnPlayerAttempts = 10;
/** Room labels the player may be spawned in, when there is nowhere better */
export const spawnRoomLabels = ["corridor", "common"];
/** Upper bound of the "npc radius" slider in `WorldMenu.tsx` — also used to size the occlusion march. */
export const defaultAmbientIntensity = 1;

export const defaultCameraMode: import("./components/CameraControls").CameraModeType = isTouchDevice()
  ? "free"
  : "canonical";
/**
 * How the camera follows the player — an option of EITHER mode, not a mode of its own: `loose` keeps them
 * framed, `tight` also keeps it behind their facing
 */
export const followModes = ["off", "loose", "tight"] as const;
export type FollowMode = (typeof followModes)[number];
export const defaultFollowMode: FollowMode = "off";

/**
 * `canonical` camera mode: how far out — as a fraction of the travel between the zoom's stops —
 * the polar starts easing towards birdseye. See `WorldView`'s `onCameraFrame`
 */
export const canonicalFlattenFrom = 0.4;
/**
 * ...and how far out a drag locks to one axis. On a phone the zoom is free and comes to rest
 * anywhere, so "zoomed in" reaches much further out than the mouse's inner stop
 */
export const canonicalAxisLockFrom = isTouchDevice() ? 0.85 : canonicalFlattenFrom;
/**
 * What the rgb shift is scaled to at the outer zoom stop: zoomed out the whole ship is in frame and
 * the parted channels read as a blur over everything rather than an edge on what is near
 */
export const rgbShiftZoomedOutScale = 1;
/** `canonical` turn let go with ctrl held is a detented compass dial: past this, it advances a point */
export const canonicalSnapArm = (10 * Math.PI) / 180;
/**
 * …but turning BACK by this much, within the same held drag, reads as a peek rather than a turn:
 * the dial returns to the point it set out from, however far round it got on the way
 */
export const canonicalSnapCancel = (4 * Math.PI) / 180;
/** How fast a `canonical` aimed zoom-in settles, per second — see `CameraControls.zoomSettleRate` */
export const canonicalZoomInRate = 2.8;
/** The zoom crosshair sits this far off the floor, so it is not in the floor's own plane */
export const crosshairY = 0.01;
/**
 * `canonical` zoomed out: the view FRAMES the player and their frontier — the point ahead their
 * light reaches — panning between them and drawing the outer zoom stop in until both are in view.
 * See `service/player-frontier`, and `WorldView`'s `easeFrontier` and `followPlayer`.
 * Half the fan of directions that is read, in degrees; how fast the stop eases, per second; the
 * nearest it comes, as a share of the travel between the stops; the slack the fit is given, as a
 * factor; and how far from the player towards the frontier the follow holds the view — `0.5`
 * is the midpoint, `0` the player as ever
 */
export const frontierHalfDeg = 15;
export const frontierRate = 2;
/** How fast the frontier vector itself is eased, per second — the reading leaps, and a turn swings it */
export const frontierSmoothRate = 3;
/**
 * …and whilst the player is off the mesh or mid fade-spawn, when their facing changes twice in
 * quick succession — turned to face a doable, then set by it — which the camera should glide over
 */
export const frontierCalmRate = 0.8;
/** The least time between two reads of the sweep — the ease above hides anything quicker */
export const frontierReadMinMs = 50;
export const frontierNearFrac = 0.05; // not `0`: `t` divides by the travel that would leave
export const frontierMargin = 1.3;
export const frontierPanFrac = 0.5;
/** The nearest the INNER stop comes, in metres, when the frontier is close — see `easeFrontier` */
export const frontierNearest = 4;

/** Camera rotate speed: touch drags are much shorter than mouse drags, so they get more per-pixel */
export const rotateSpeedDesktop = 1;
export const rotateSpeedMobile = 1.75;
/** Camera zoom speed: applied as an exponent to the pinch spread ratio (and to the wheel scale) */
export const zoomSpeedDesktop = 0.3;
export const zoomSpeedMobile = 0.8;

export const defaultWorldTheme: import("./assets.schema").WorldTheme = {
  post: { lightBg: "#ffffff", darkBg: "#000000", fadedFloorTint: 0.1, fadedObstacleTint: 0.1 },
  background: "bg-[#000]", // seeing initial flicker
  ceiling: {
    hull: { fill: "#000", stroke: "#666" },
    nonHull: { fill: "#444", stroke: "#000" },
  },
  floor: {
    /**
     * The structural ground inside the hull, between rooms — see `Floor`'s `drawHullFloor`. The
     * deck laid on top of it is `deckConfig` in `service/texture`, not part of the theme, so that
     * it is one mutable object to tune against
     */
    hullFill: "#0b0d10",
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

/** How long a map change fades to black, and back from it once the next map is up */
export const mapVeilMs = 400;
/** How long the FIRST map is held as a flat hull before the world rises out of it */
export const unfoldDelayMs = 500;
/** How long the risen world is left alone before the camera pans onto the player */
export const introPanDelayMs = 350;

export const MAX_GEOMORPH_INSTANCES = 8;

export const MAX_OBSTACLE_QUAD_INSTANCES = 1024;

export const MAX_OBSTACLE_SKIRT_INSTANCES = 2048;

/**
 * A decor quad is represented as a cuboid with single textured face.
 */
export const MAX_DECOR_QUAD_INSTANCES = 1024;

export const MAX_NPCS = 256;

/** Per-world cap on doors, sizing `Doors`' instanced mesh and `service/player-light`'s buffers */
export const MAX_DOORS = 512;

export const MAX_ROOMS_PER_GEOMORPH = 32;

/** Each takes a slot of its own and is shown whenever any adjacent room is. */
export const MAX_BROAD_WALLS_PER_GEOMORPH = 16;

export const MAX_DOOR_LABELS = 32;

/**
 * Room labels are drawn once per DISTINCT text ("stateroom", "bridge", …) and shared by every
 * room saying it, so this bounds the vocabulary of a map rather than its room count
 */
export const MAX_ROOM_LABELS = 32;
/** Cap on the billboards themselves — one per labelled decor point */
export const MAX_ROOM_LABEL_INSTANCES = 256;
/** How big a room label stands in the world (metres) */
export const roomLabelWidth = 1.6;
export const roomLabelHeight = 0.4;
/** How long the room labels take to come in, once the first boot's reveal has settled */
export const roomLabelRevealMs = 0;
/**
 * A room label fades with the zoom: `roomLabelNearAlpha` until this far out of the travel between
 * the stops, and fully back only at the outer stop. Anything but zoomed out the room is plain to
 * see and its name is mostly in the way
 */
export const roomLabelFadeFrom = 0.8;
/** How much of a room label is left at the near stop */
export const roomLabelNearAlpha = 0;
/** The texture array behind them — see `RoomLabels` */
export const roomLabelTexOpts = {
  ctKey: "room-labels",
  width: 256,
  height: 64,
  numTextures: MAX_ROOM_LABELS,
  srgb: true,
  anisotropy: 4,
};

/** In meters, or equivalently 2 grid squares */
export const decorGridSize = geomorphGridMeters * 2;

export const decorKeyFallback = "icon--warn";
export const decorPointKeyFallback = "abstract-point";

/** 15 (meters) */
export const gmIdGridDim = 600 * sguToWorldScale;

export const colliderHeight = 0.025;

export const defaultDoorCloseMs = 5000;

/** What the busy overlay says whilst shaders compile — a toggle's recompile, or the pick warm */
export const compilingShadersText = "compiling shaders";

export const html3DOpacityCssVar = "--html-3d-opacity";

/** How solid a door looks. Dithered rather than blended — see `Doors`' `alphaHash` */
export const defaultDoorOpacity = 0.8;

export const lockedDoorTint = "#f44";

export const unlockedDoorTint = "#4b4";

export const defaultSkinKey = "medic-0";
