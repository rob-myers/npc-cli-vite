import { float, getViewPosition, mix, screenUV, uniform, vec3, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";

export type XzCirclePostprocessOpts = {
  /** World-space radius of the circle */
  radius: number;
  /** World-space distance over which the transition fades in, starting at `radius`. Default `0.6` */
  falloff?: number;
  /** Draw a solid red border ring at `radius`? Default `false` (debug only) */
  showBorder?: boolean;
  /** World-space height (y) of the XZ plane the circle is drawn on. Default `0` */
  planeHeight?: number;
};

export type XzCirclePostprocess = {
  center: THREE.UniformNode<"vec2", THREE.Vector2>;
  radius: THREE.UniformNode<"float", number>;
  /** `0` (default, fully bypassed) or `1` (drawn). Toggle via `setActive`. */
  active: THREE.UniformNode<"float", number>;
  setActive(active: boolean): void;
  /** Feed the real scene camera (not the internal post-processing quad camera) and look-at target */
  update(camera: THREE.Camera, target: THREE.Vector3): void;
  /** World XZ position (vec2) where the current fragment's view ray hits the `planeHeight` plane */
  groundXZ(): THREE.Node<"vec2">;
  /**
   * `insideColor` is shown inside `radius`, fading out to `outsideColor` beyond it (both are
   * expected to be pre-computed, e.g. a light vs. heavy `colorBleeding` pass over the same scene
   * texture). Passes `insideColor` through everywhere when inactive.
   */
  apply(insideColor: THREE.Node<"vec3">, outsideColor: THREE.Node<"vec3">): THREE.Node<"vec3">;
};

/** Cosmetic constants for the (debug-only) border ring — not worth exposing as options */
const borderWidth = 0.01;

/**
 * Post-processing helper drawing a circle on a horizontal `y = planeHeight` plane, centered at a
 * world XZ point kept in sync via `update`. Each fragment's view ray is intersected with that
 * plane to find its world XZ position, which decides the mix between `insideColor` and
 * `outsideColor` passed to `apply`.
 *
 * 🔔 TSL's built-in `cameraPosition` / `cameraProjectionMatrixInverse` / `cameraWorldMatrix`
 * resolve to whatever camera renders the *current* pass — inside a post-processing composite
 * pass that's an internal fullscreen-quad camera, not the real scene camera. So the real
 * camera's matrices are copied into our own uniforms via `update` instead.
 */
export function createXzCirclePostprocess(opts: XzCirclePostprocessOpts): XzCirclePostprocess {
  const center = uniform(new THREE.Vector2());
  const radius = uniform(opts.radius);
  const falloff = opts.falloff ?? 0.6;
  const showBorder = opts.showBorder ?? false;
  const planeHeight = opts.planeHeight ?? 0;

  const camProjectionMatrixInverse = uniform(new THREE.Matrix4());
  const camWorldMatrix = uniform(new THREE.Matrix4());
  const camPosition = uniform(new THREE.Vector3());
  const active = uniform(0);

  function groundXZ() {
    // reconstruct the view ray direction (only direction matters, so depth value is arbitrary)
    const viewDirPoint = getViewPosition(screenUV, float(0.5), camProjectionMatrixInverse);
    const worldDir = camWorldMatrix.mul(vec4(viewDirPoint, 0.0)).xyz.normalize();
    // intersect with y=planeHeight: camPosition.y + t * worldDir.y = planeHeight
    const t = float(planeHeight).sub(camPosition.y).div(worldDir.y);
    return camPosition.add(worldDir.mul(t)).xz;
  }

  return {
    center,
    radius,
    active,
    setActive(isActive) {
      active.value = isActive ? 1 : 0;
    },
    update(camera, target) {
      center.value.set(target.x, target.z);
      // ensure matrixWorld reflects this frame's position/orientation, not last frame's
      camera.updateMatrixWorld();
      camProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
      camWorldMatrix.value.copy(camera.matrixWorld);
      camPosition.value.copy(camera.position);
    },
    groundXZ,
    apply(insideColor, outsideColor) {
      const groundHit = groundXZ();
      const dist = groundHit.sub(center).length();

      // 1 inside radius, fading to 0 by radius + falloff
      const litAmount = float(1).sub(dist.sub(radius).div(falloff).clamp(0, 1));
      const outsideAmount = float(1).sub(litAmount);

      let effect = mix(insideColor, outsideColor, outsideAmount);

      if (showBorder) {
        const onRing = dist.sub(radius).abs().lessThan(borderWidth);
        effect = mix(effect, vec3(1, 0, 0), onRing.select(float(1), float(0)));
      }

      // fully bypass (always insideColor everywhere) unless made active via `setActive`
      return mix(insideColor, effect, active);
    },
  };
}
