/** Size of starship geomorphs grid side in meters */
export const geomorphGridMeters = 1.5;
export const sguToWorldScale = (1 / 60) * geomorphGridMeters;
export const decorIconRadius = 5 * sguToWorldScale;
export const decorIconRadiusOutset = 2 * sguToWorldScale;
export const doorSwitchHeight = 1;
/** SVG symbols are drawn 5 times larger */
export const sguSymbolScaleUp = 5;
/** SVG symbols are drawn 5 times larger */
export const sguSymbolScaleDown = 1 / sguSymbolScaleUp;

export const obstacleOutset = 8 * sguToWorldScale;
export const precision = 4;
/**
 * Walls with any of these tags will not be merged with adjacent walls
 * - `y` (numeric) Height of base off the floor
 * - `h` (numeric) Height of wall
 * - `broad` (true) Not thin e.g. back of lifeboat
 */
export const specialWallMetaKeys = /** @type {const} */ (["y", "h", "broad", "hollow"]);
export const wallOutset = 10 * sguToWorldScale;

/** Depth of doorway along line walking through door */
export const doorDepth = 20 * sguToWorldScale * sguSymbolScaleDown;
/** Depth of doorway along line walking through hull door */
export const hullDoorDepth = 40 * sguToWorldScale * sguSymbolScaleDown;
/**
 * Smaller than @see {offMeshConnectionHalfDepth}
 */
export const connectorEntranceHalfDepth = {
  hull: 0.25 + wallOutset,
  nonHull: 0.125 + wallOutset,
};
