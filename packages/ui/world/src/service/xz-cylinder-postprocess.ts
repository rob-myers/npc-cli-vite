import {
  Break,
  Fn,
  float,
  getViewPosition,
  If,
  Loop,
  mix,
  screenUV,
  uniform,
  uniformArray,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { MAX_POSTPROCESS_LIGHTS } from "../const";

export type XzCylinderPostprocessOpts = {
  /** World-space height (y) of each cylinder's bottom rim. Default `0` */
  bottomHeight?: number;
  /** World-space height (y) of each cylinder's top rim */
  topHeight: number;
  /** World-space distance over which the transition fades in, starting at a light's own radius. Default `0.6` */
  falloff?: number;
  /** Draw a debug wireframe (two rims + vertical lines) per active light? Default `false`. Toggle later via `setShowBorder`. */
  showBorder?: boolean;
};

export type XzCylinderPostprocess = {
  /** `0` or `1`. Toggle via `setShowBorder`. */
  showBorder: THREE.UniformNode<"float", number>;
  setShowBorder(showBorder: boolean): void;
  /** Feed the real scene camera (not the internal post-processing quad camera) — shared by every light */
  update(camera: THREE.Camera): void;

  /** The single "tracked" light — e.g. follows a live reference like `npc.position`. Not managed via `addLight`/`removeLight`. */
  setTrackedActive(active: boolean): void;
  setTrackedCenter(x: number, z: number): void;
  setTrackedRadius(radius: number): void;

  /** Creates a "static" light at `point` with its own `radius`. Returns its slot index, or `null` if all `MAX_POSTPROCESS_LIGHTS` slots are in use. */
  addLight(point: { x: number; z: number }, radius: number): number | null;
  removeLight(index: number): void;
  /**
   * Nearest active static light whose own radius contains the clicked ray's `[bottomXZ, topXZ]`
   * segment, else `null`. Takes a segment (not a single ground point) so this matches what's
   * actually visible on screen — `litAmount()` tests the *segment*, not just the ground hit, so
   * a light can appear "under the cursor" from an angled camera even when the raycast-hit floor
   * point itself is outside the light's flat XZ radius.
   */
  findLightNear(bottomXZ: { x: number; z: number }, topXZ: { x: number; z: number }): number | null;
  /** Deactivates every static light (and the tracked light) in one pass */
  resetLights(): void;

  /** `1` inside any active light (tracked or static), fading to `0` over `falloff` — unions all lights */
  litAmount(): THREE.Node<"float">;
  /** Draws every active light's debug wireframe on top of `color` (no-op when `showBorder` is off) */
  drawBorder(color: THREE.Node<"vec3">): THREE.Node<"vec3">;
};

/** Cosmetic constants for the (debug-only) wireframe — not worth exposing as options */
const borderWidth = 0.01;
const debugLineCount = 8;

/**
 * Post-processing helper for many vertical cylinders (axis along y, from `bottomHeight` to
 * `topHeight`) unioned together: one "tracked" light (position set live, e.g. to follow an npc)
 * plus up to `MAX_POSTPROCESS_LIGHTS` independent "static" lights, each with its own radius.
 *
 * Since there's no usable depth buffer (see 🔔 below), each fragment's view ray is intersected
 * with the `bottomHeight` and `topHeight` planes ONCE per fragment (shared by every light) to
 * get the ray segment's two endpoints; each light then only needs a cheap point-to-segment
 * distance test against that shared segment.
 *
 * 🔔 TSL's built-in `cameraPosition` / `cameraProjectionMatrixInverse` / `cameraWorldMatrix`
 * resolve to whatever camera renders the *current* pass — inside a post-processing composite
 * pass that's an internal fullscreen-quad camera, not the real scene camera. So the real
 * camera's matrices are copied into our own uniforms via `update` instead.
 */
export function createXzCylinderPostprocess(opts: XzCylinderPostprocessOpts): XzCylinderPostprocess {
  const falloff = opts.falloff ?? 0.6;
  const bottomHeight = opts.bottomHeight ?? 0;
  const topHeight = opts.topHeight;

  const camProjectionMatrixInverse = uniform(new THREE.Matrix4());
  const camWorldMatrix = uniform(new THREE.Matrix4());
  const camPosition = uniform(new THREE.Vector3());
  const showBorder = uniform(opts.showBorder ? 1 : 0);

  // the tracked light
  const trackedCenter = uniform(new THREE.Vector2());
  const trackedActive = uniform(0);
  const trackedRadius = uniform(1);

  // static lights: vec4(worldX, worldZ, activeFlag, radius) — mirrored in plain JS for CPU-side
  // hit-testing (no GPU readback needed), same idiom as Walls.tsx's light0Values/light1Values
  const slots = Array.from({ length: MAX_POSTPROCESS_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 0));
  const lightsNode = uniformArray<"vec4">(slots, "vec4");
  /** Highest active slot index + 1 — lets the shader `Loop` `Break` early instead of scanning all `MAX_POSTPROCESS_LIGHTS` */
  const hiWater = uniform(0);

  function recomputeHiWater() {
    let hi = 0;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i].z !== 0) hi = i + 1;
    }
    hiWater.value = hi;
  }

  function rayXZAt(planeHeight: number) {
    // reconstruct the view ray direction (only direction matters, so depth value is arbitrary)
    const viewDirPoint = getViewPosition(screenUV, float(0.5), camProjectionMatrixInverse);
    const worldDir = camWorldMatrix.mul(vec4(viewDirPoint, 0.0)).xyz.normalize();
    // intersect with y=planeHeight: camPosition.y + t * worldDir.y = planeHeight
    const t = float(planeHeight).sub(camPosition.y).div(worldDir.y);
    return camPosition.add(worldDir.mul(t)).xz;
  }

  // distance from 2D point `p` to the 2D segment [a, b]
  function distToSegment(p: THREE.Node<"vec2">, a: THREE.Node<"vec2">, b: THREE.Node<"vec2">) {
    const ab = b.sub(a);
    const t = p.sub(a).dot(ab).div(ab.dot(ab)).clamp(0, 1);
    return p.sub(a.add(ab.mul(t))).length();
  }

  // CPU-side mirror of `distToSegment`, for hit-testing clicks against the same segment `litAmount()` uses
  function distToSegment2D(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
    const abx = bx - ax;
    const abz = bz - az;
    const abLenSq = abx * abx + abz * abz;
    const t = abLenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / abLenSq)) : 0;
    return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
  }

  return {
    showBorder,
    setShowBorder(isShown) {
      showBorder.value = isShown ? 1 : 0;
    },
    update(camera) {
      // ensure matrixWorld reflects this frame's position/orientation, not last frame's
      camera.updateMatrixWorld();
      camProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
      camWorldMatrix.value.copy(camera.matrixWorld);
      camPosition.value.copy(camera.position);
    },
    setTrackedActive(isActive) {
      trackedActive.value = isActive ? 1 : 0;
    },
    setTrackedCenter(x, z) {
      trackedCenter.value.set(x, z);
    },
    setTrackedRadius(radius) {
      trackedRadius.value = radius;
    },
    addLight(point, radius) {
      const index = slots.findIndex((s) => s.z === 0);
      if (index === -1) return null;
      slots[index].set(point.x, point.z, 1, radius);
      recomputeHiWater();
      return index;
    },
    removeLight(index) {
      slots[index].set(0, 0, 0, 0);
      recomputeHiWater();
    },
    findLightNear(bottomXZ, topXZ) {
      let bestIndex = null as number | null;
      let bestDist = Infinity;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (s.z === 0) continue; // empty slot
        const dist = distToSegment2D(s.x, s.y, bottomXZ.x, bottomXZ.z, topXZ.x, topXZ.z);
        if (dist <= s.w && dist < bestDist) {
          bestDist = dist;
          bestIndex = i;
        }
      }
      return bestIndex;
    },
    resetLights() {
      for (const s of slots) s.set(0, 0, 0, 0);
      hiWater.value = 0;
      trackedActive.value = 0;
    },
    litAmount() {
      return Fn(() => {
        const bottomXZ = rayXZAt(bottomHeight);
        const topXZ = rayXZAt(topHeight);
        const litMax = float(0).toVar();

        If(trackedActive.notEqual(0), () => {
          const dist = distToSegment(trackedCenter, bottomXZ, topXZ);
          litMax.assign(litMax.max(float(1).sub(dist.sub(trackedRadius).div(falloff).clamp(0, 1))));
        });

        Loop(MAX_POSTPROCESS_LIGHTS, ({ i }) => {
          If(i.greaterThanEqual(hiWater.toInt()), () => {
            Break();
          });
          const l = lightsNode.element(i);
          If(l.z.notEqual(0), () => {
            const dist = distToSegment(l.xy, bottomXZ, topXZ);
            // l.w = this light's own radius
            litMax.assign(litMax.max(float(1).sub(dist.sub(l.w).div(falloff).clamp(0, 1))));
          });
        });

        return litMax;
      })();
    },
    drawBorder(color) {
      return Fn(() => {
        const bottomXZ = rayXZAt(bottomHeight);
        const topXZ = rayXZAt(topHeight);
        const onWireframe = float(0).toVar();

        function markIfOnWireframe(center: THREE.Node<"vec2">, radius: THREE.Node<"float">) {
          const onBottomRing = bottomXZ.sub(center).length().sub(radius).abs().lessThan(borderWidth);
          const onTopRing = topXZ.sub(center).length().sub(radius).abs().lessThan(borderWidth);
          let onLight = onBottomRing.or(onTopRing);
          // vertical lines around the rim: each is a fixed XZ point spanning bottomHeight..topHeight,
          // so (like the cylinder's own axis test) it reduces to a point-to-segment distance
          for (let i = 0; i < debugLineCount; i++) {
            const angle = (i / debugLineCount) * Math.PI * 2;
            const rimPoint = center.add(vec2(Math.cos(angle), Math.sin(angle)).mul(radius));
            const onLine = distToSegment(rimPoint, bottomXZ, topXZ).lessThan(borderWidth);
            onLight = onLight.or(onLine);
          }
          onWireframe.assign(onWireframe.max(onLight.select(float(1), float(0))));
        }

        If(trackedActive.notEqual(0), () => {
          markIfOnWireframe(trackedCenter, trackedRadius);
        });

        Loop(MAX_POSTPROCESS_LIGHTS, ({ i }) => {
          If(i.greaterThanEqual(hiWater.toInt()), () => {
            Break();
          });
          const l = lightsNode.element(i);
          If(l.z.notEqual(0), () => {
            markIfOnWireframe(l.xy, l.w);
          });
        });

        return mix(color, vec3(1, 0, 0), onWireframe.mul(showBorder));
      })();
    },
  };
}
