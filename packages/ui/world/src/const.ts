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

export const decorIconRadius = 5 * sguToWorldScale;
export const decorIconRadiusOutset = 2 * sguToWorldScale;
export const doorSwitchHeight = 1;

export const obstacleOutset = 8 * sguToWorldScale;
/**
 * Walls with any of these tags will not be merged with adjacent walls
 * - `y` (numeric) Height of base off the floor
 * - `h` (numeric) Height of wall
 * - `broad` (true) Not thin e.g. back of lifeboat
 */

export const wallOutset = 10 * sguToWorldScale;
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
export const gmFloorExtraScale = 2;

/** This is the width, but also the height even for edge geomorphs, because we use texture arrays. */
export const floorTextureDimension = Math.ceil(geomorphPngRectWidth * worldToSguScale * gmFloorExtraScale);

/** Assumed to exist inside `assets.json` `map` lookup */
export const emptyMapKey = "empty-map";

/** Assumed to exist inside `assets.json` `map` lookup */
export const defaultMapKey = "small-map-0";

/** The value of @see {emptyMapKey} */
export const emptyMapDef: import("./assets.schema").AssetsMapDef = {
  key: emptyMapKey,
  gms: [],
};

export const assetsJsonChangingEvent = "assets-json-changing";
export const assetsJsonChangedEvent = "assets-json-changed";
export const mapEditSymbolSavedEvent = "map-edit:symbol-saved";

export const brightnessStorageKey = `world-brightness-value`;

export const defaultThemeKey = "default";

export const defaultWorldTheme: import("./assets.schema").WorldTheme = {
  background: "bg-gray-800",
  ceiling: {
    hull: { fill: "#000", stroke: "#666" },
    nonHull: { fill: "#444", stroke: "#000" },
  },
  walls: { color: "#000000" },
};

export const wallHeight = 2;

export const MAX_GEOMORPH_INSTANCES = 64;

export const MAX_OBSTACLE_QUAD_INSTANCES = 1024;
