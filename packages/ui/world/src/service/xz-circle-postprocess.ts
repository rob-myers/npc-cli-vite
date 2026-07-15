import { float, getViewPosition, mix, screenUV, select, uniform, vec3, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import type { SelectAnyType } from "./texture";

export type XzCirclePostprocessOpts = {
  /** World-space radius of the circle */
  radius: number;
  /** World-space thickness of the drawn border (either side of `radius`) */
  borderWidth?: number;
  /** Border color as `[r, g, b]` in `0..1` */
  color?: [number, number, number];
  /** Solid color tint applied outside the circle, as `[r, g, b]` in `0..1`. Default deep blue */
  tintColor?: [number, number, number];
  /** How strongly the tint is applied outside the circle: 0 = no tint, 1 = fully tinted. Default `0.75` */
  darkness?: number;
  /** How much darker (multiplicatively) it gets outside the circle: 0 = none, 1 = fully black. Default `0.6` */
  darkenAmount?: number;
  /** World-space distance over which the tint/darkening fade in, starting at `radius`. Default `0.6` */
  falloff?: number;
  /** Draw the colored border ring at `radius`? Default `false` */
  showBorder?: boolean;
};

export type XzCirclePostprocess = {
  center: THREE.UniformNode<"vec2", THREE.Vector2>;
  radius: THREE.UniformNode<"float", number>;
  /** Feed the real scene camera (not the internal post-processing quad camera) and look-at target */
  update(camera: THREE.Camera, target: THREE.Vector3): void;
  /** Draws the circle's border on top of `inputColor` */
  apply(inputColor: THREE.Node<"vec3">): THREE.Node<"vec3">;
};

/**
 * Post-processing helper drawing a circle (with colored border) on the `y = 0` ground plane,
 * centered at a world XZ point kept in sync via `update`. Each fragment's view ray is
 * intersected with the ground plane to find its world XZ position.
 *
 * 🔔 TSL's built-in `cameraPosition` / `cameraProjectionMatrixInverse` / `cameraWorldMatrix`
 * resolve to whatever camera renders the *current* pass — inside a post-processing composite
 * pass that's an internal fullscreen-quad camera, not the real scene camera. So the real
 * camera's matrices are copied into our own uniforms via `update` instead.
 */
export function createXzCirclePostprocess(opts: XzCirclePostprocessOpts): XzCirclePostprocess {
  const center = uniform(new THREE.Vector2());
  const radius = uniform(opts.radius);
  const borderWidth = opts.borderWidth ?? 0.15;
  const [r, g, b] = opts.color ?? [1, 0, 0];
  const [tr, tg, tb] = opts.tintColor ?? [0.05, 0.05, 0.05];
  const darkness = opts.darkness ?? 0.75;
  const darkenAmount = opts.darkenAmount ?? 0.7;
  const falloff = opts.falloff ?? 0.6;
  const showBorder = opts.showBorder ?? false;

  const camProjectionMatrixInverse = uniform(new THREE.Matrix4());
  const camWorldMatrix = uniform(new THREE.Matrix4());
  const camPosition = uniform(new THREE.Vector3());

  return {
    center,
    radius,
    update(camera, target) {
      center.value.set(target.x, target.z);
      // ensure matrixWorld reflects this frame's position/orientation, not last frame's
      camera.updateMatrixWorld();
      camProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
      camWorldMatrix.value.copy(camera.matrixWorld);
      camPosition.value.copy(camera.position);
    },
    apply(inputColor) {
      // reconstruct the view ray direction (only direction matters, so depth value is arbitrary)
      const viewDirPoint = getViewPosition(screenUV, float(0.5), camProjectionMatrixInverse);
      const worldDir = camWorldMatrix.mul(vec4(viewDirPoint, 0.0)).xyz.normalize();
      // intersect with y=0: camPosition.y + t * worldDir.y = 0
      const t = camPosition.y.negate().div(worldDir.y);
      const groundHit = camPosition.add(worldDir.mul(t));
      const dist = groundHit.xz.sub(center).length();

      // 1 inside radius, fading to 0 by radius + falloff
      const litAmount = float(1).sub(dist.sub(radius).div(falloff).clamp(0, 1));
      const outsideAmount = float(1).sub(litAmount);
      // tint towards a fixed solid color outside the circle — always visible, regardless of
      // how dark the underlying scene is (unlike darkening/desaturating/inverting near-black colors)
      const tinted = mix(inputColor, vec3(tr, tg, tb), outsideAmount.mul(darkness));
      // additionally darken (multiplicatively) outside the circle
      const result = tinted.mul(float(1).sub(outsideAmount.mul(darkenAmount)));

      if (!showBorder) {
        return result;
      }

      const onBorder = dist.sub(radius).abs().lessThan(borderWidth);
      return (select as SelectAnyType)(onBorder, vec3(r, g, b), result) as THREE.Node<"vec3">;
    },
  };
}
