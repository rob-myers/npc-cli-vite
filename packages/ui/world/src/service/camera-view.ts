import { isTouchDevice } from "@npc-cli/util/legacy/dom";
import * as THREE from "three/webgpu";
import { cameraFov, defaultCameraMaxDistance, defaultCameraMinDistance } from "../const.env";
import type { CameraView } from "./storage";

/** Metres of floor seen top to bottom from `distance` away, at a vertical `fov` in degrees */
function viewOfDistance(distance: number, fov: number) {
  return 2 * distance * Math.tan(fov * 0.5 * THREE.MathUtils.DEG2RAD);
}

/** How far away the camera sees `view` metres of floor top to bottom, at a vertical `fov` in degrees */
export function distanceOfView(view: number, fov: number) {
  return view / (2 * Math.tan(fov * 0.5 * THREE.MathUtils.DEG2RAD));
}

/** The zoom stops that show `view`'s floor at its fov, as `ctrlOpts` names them */
export function getZoomStops(view: CameraView) {
  return { minDistance: distanceOfView(view.nearView, view.fov), maxDistance: distanceOfView(view.farView, view.fov) };
}

/** `cameraFov`, and the floor the device's default zoom stops show at it */
export function getDefaultCameraView(): CameraView {
  return {
    fov: cameraFov,
    nearView: viewOfDistance(defaultCameraMinDistance, cameraFov),
    farView: viewOfDistance(defaultCameraMaxDistance, cameraFov),
  };
}

/** Metres of floor the near stop shows at least: as zoomed in as a framing goes */
export const minNearView = 3;

/**
 * Framings to try: a wider fov nearer in, so the near stop shows less floor. `near` and `far` scale the
 * default's views, the far less the wider the fov, to stay zoomed in. A `near` of `null` is `minNearView`: `high`'s on touch
 */
export const cameraPresets = {
  low: { fov: 20, near: 1.2, far: 1 },
  mid: { fov: 30, near: 1, far: 0.85 },
  high: { fov: 45, near: isTouchDevice() ? null : 0.8, far: 0.7 },
} as const;

/** Each key's step through the presets, low to high — see `WorldView`'s `onKeyDown`. `=` is `+` unshifted */
export const cameraPresetStepByKey: Partial<Record<string, -1 | 1>> = { "-": -1, "+": 1, "=": 1 };

/** The preset `step` from the one nearest `view` by fov, held at either end */
export function stepCameraPreset(view: CameraView, step: -1 | 1): keyof typeof cameraPresets {
  const names = Object.keys(cameraPresets) as (keyof typeof cameraPresets)[];
  const fovGap = (name: keyof typeof cameraPresets) => Math.abs(cameraPresets[name].fov - view.fov);
  const at = names.reduce((best, name, i) => (fovGap(name) < fovGap(names[best]) ? i : best), 0);
  return names[Math.max(0, Math.min(names.length - 1, at + step))];
}

/** A preset's framing on this device: its fov, and the default views scaled */
export function getPresetCameraView(name: keyof typeof cameraPresets): CameraView {
  const { fov, near, far } = cameraPresets[name];
  const { nearView, farView } = getDefaultCameraView();
  const presetNear = near === null ? minNearView : nearView * near;
  return { fov, nearView: presetNear, farView: Math.max(farView * far, presetNear) };
}
