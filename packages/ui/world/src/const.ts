export const precision = 4;

/** Size of starship geomorphs grid side in meters */
export const geomorphGridMeters = 1.5;
/** In SVG symbols (sgu) the grid is 60x60 */
export const sguToWorldScale = (1 / 60) * geomorphGridMeters;

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
export const specialWallMetaKeys = /** @type {const} */ (["y", "h", "broad", "hollow"]);

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
