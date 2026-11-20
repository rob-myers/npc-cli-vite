/**
 * Dispatched on a canvas just before it is copied, e.g. into a tab's drag preview.
 * A WebGL or WebGPU canvas then redraws synchronously, since its last frame is gone.
 */
export const redrawForSnapshotEvent = "redraw-for-snapshot";
