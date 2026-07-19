import {
  Break,
  Fn,
  float,
  getViewPosition,
  If,
  int,
  Loop,
  logarithmicDepthToViewZ,
  mix,
  screenUV,
  uniform,
  uniformArray,
  vec2,
  vec3,
  vec4,
  viewZToPerspectiveDepth,
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
  /** Are lights' dimming/tinting effect active? Default `true`. Toggle later via `setLightsEnabled`. */
  lightsEnabled?: boolean;
};

export type XzCylinderPostprocess = {
  /** `0` or `1`. Toggle via `setShowBorder`. */
  showBorder: THREE.UniformNode<"float", number>;
  setShowBorder(showBorder: boolean): void;
  /** `0` or `1`. When `0`, `litAmount()` always returns unlit (as if no lights exist), so the outside dimming/tinting applies everywhere. Toggle via `setLightsEnabled`. */
  lightsEnabled: THREE.UniformNode<"float", number>;
  setLightsEnabled(lightsEnabled: boolean): void;
  /** Feed the real scene camera (not the internal post-processing quad camera) — shared by every light */
  update(camera: THREE.Camera): void;

  /**
   * The single "tracked" light — e.g. follows a live reference like `npc.position`. Not managed
   * via `addLight`/`removeLight`. Pass `null` to deactivate (center/radius left as last known,
   * harmless while inactive). Omitting `radius` while re-centering keeps the last radius set.
   */
  setTracked(center: { x: number; z: number } | null, radius?: number): void;
  /** Clips the tracked light to this world-space room polygon (or removes clipping if omitted/empty) */
  setTrackedRoomOutline(roomOutline?: { x: number; z: number }[]): void;

  /**
   * A second, independent single light — used for the hold-to-grow static-light sizing preview,
   * so it never competes with the tracked light (e.g. an npc-following light stays visible and
   * correct while a new static light is simultaneously being sized elsewhere). Same semantics as
   * `setTracked`.
   */
  setPreview(center: { x: number; z: number } | null, radius?: number): void;
  /** Clips the preview light to this world-space room polygon (or removes clipping if omitted/empty) */
  setPreviewRoomOutline(roomOutline?: { x: number; z: number }[]): void;

  /**
   * Creates a "static" light at `point` with its own `radius`. Returns its slot index, or `null`
   * if all `MAX_POSTPROCESS_LIGHTS` slots are in use.
   * @param roomOutline World-space outline of the room `point` is in — if provided, the light is
   * clipped to this polygon (won't leak into neighbouring rooms) in addition to its own radius.
   * Omit for an unclipped (plain circular) light.
   */
  addLight(
    point: { x: number; z: number },
    radius: number,
    roomOutline?: { x: number; z: number }[],
  ): number | null;
  removeLight(index: number): void;
  /**
   * Nearest active static light whose own radius contains the clicked ray's `[bottomXZ, topXZ]`
   * segment, else `null`. Takes a segment (not a single ground point) since `litAmount()` tests
   * the segment too — matches what's actually visible on screen from an angled camera.
   * @param groundPoint The actual raycast-hit ground point (not the plane-projected segment,
   * which — being an infinite-plane intersection unconstrained by walls — can sweep straight
   * through an unrelated room). Also required to be inside the candidate light's own room-poly
   * clip, so a click that only *passes over* another room's light via the swept segment doesn't
   * falsely register as a hit on it.
   */
  findLightNear(
    bottomXZ: { x: number; z: number },
    topXZ: { x: number; z: number },
    groundPoint: { x: number; z: number },
  ): number | null;
  /** Deactivates every static light (and the tracked light) in one pass */
  resetLights(): void;

  /**
   * `1` inside any active light (tracked or static), fading to `0` over `falloff` — unions all
   * lights, testing each fragment's reconstructed real world position (see impl. for why).
   * @param sceneDepth The scene's depth texture (e.g. `scenePass.getTextureNode("depth")`) — raw
   * logarithmic depth, NOT pre-linearized; this function does its own log-depth inversion.
   */
  litAmount(sceneDepth: THREE.Node<"float">): THREE.Node<"float">;
  /** Draws every active light's debug wireframe on top of `color` (no-op when `showBorder` is off) */
  drawBorder(color: THREE.Node<"vec3">): THREE.Node<"vec3">;
};

/** Cosmetic constants for the (debug-only) wireframe — not worth exposing as options */
const borderWidth = 0.01;
/** Per-light cap on room-polygon vertices for clipping — matches Debug.tsx's MAX_ROOM_POLY_VERTS */
const maxRoomPolyVerts = 64;
const debugLineCount = 8;

/**
 * Post-processing helper for many vertical cylinders (axis along y, from `bottomHeight` to
 * `topHeight`) unioned together: one "tracked" light (position set live, e.g. to follow an npc)
 * plus up to `MAX_POSTPROCESS_LIGHTS` independent "static" lights, each with its own radius.
 *
 * `litAmount()` reconstructs each fragment's REAL world position from the scene's depth buffer
 * and tests lights against that, not a plane-projected approximation — otherwise anything
 * screen-aligned with a light but at a different depth (e.g. an npc behind it) would be lit
 * incorrectly. `drawBorder()` (debug wireframe only) instead intersects the view ray with the
 * `bottomHeight`/`topHeight` planes directly — cheaper, and fine since it's just a wireframe.
 *
 * 🔔 TSL's built-in `cameraPosition`/`cameraProjectionMatrixInverse`/`cameraWorldMatrix` resolve
 * to whatever camera renders the *current* pass — inside post-processing that's an internal
 * fullscreen-quad camera, not the real scene camera — so the real camera's matrices are copied
 * into our own uniforms via `update` instead.
 */
export function createXzCylinderPostprocess(opts: XzCylinderPostprocessOpts): XzCylinderPostprocess {
  const falloff = opts.falloff ?? 0.6;
  const bottomHeight = opts.bottomHeight ?? 0;
  const topHeight = opts.topHeight;

  const camProjectionMatrixInverse = uniform(new THREE.Matrix4());
  const camWorldMatrix = uniform(new THREE.Matrix4());
  const camPosition = uniform(new THREE.Vector3());
  // needed to invert the real scene's logarithmic depth back into a world position (see litAmount)
  const camNear = uniform(0.1);
  const camFar = uniform(1000);
  const showBorder = uniform(opts.showBorder ? 1 : 0);
  const lightsEnabled = uniform(opts.lightsEnabled ?? true ? 1 : 0);

  // the tracked light: vec4(worldX, worldZ, activeFlag, radius) — same layout as static-light slots[i]
  const tracked = uniform(new THREE.Vector4(0, 0, 0, 1));
  // room-polygon clip for the tracked light only — single polygon, no per-slot indexing needed
  const trackedRoomPolyCount = uniform(0);
  const trackedRoomPolyVerts = Array.from({ length: maxRoomPolyVerts }, () => new THREE.Vector2());
  const trackedRoomPolyVertsNode = uniformArray<"vec2">(trackedRoomPolyVerts, "vec2");

  // the sizing-preview light — same shape as `tracked`, but fully independent, so the hold-to-grow
  // static-light preview never competes with (and can't disable) an active tracked light
  const preview = uniform(new THREE.Vector4(0, 0, 0, 1));
  const previewRoomPolyCount = uniform(0);
  const previewRoomPolyVerts = Array.from({ length: maxRoomPolyVerts }, () => new THREE.Vector2());
  const previewRoomPolyVertsNode = uniformArray<"vec2">(previewRoomPolyVerts, "vec2");

  // static lights: vec4(worldX, worldZ, activeFlag, radius) — mirrored in plain JS for CPU-side
  // hit-testing (no GPU readback needed), same idiom as Walls.tsx's light0Values/light1Values
  const slots = Array.from({ length: MAX_POSTPROCESS_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 0));
  const lightsNode = uniformArray<"vec4">(slots, "vec4");
  /** Highest active slot index + 1 — lets the shader `Loop` `Break` early instead of scanning all `MAX_POSTPROCESS_LIGHTS` */
  const hiWater = uniform(0);

  // per-light room-polygon clip: fixed-size block of `maxRoomPolyVerts` world-space verts per
  // light slot (simpler than Debug.tsx's packed offset/count scheme — fine at only 32 lights)
  const roomPolyInfo = Array.from({ length: MAX_POSTPROCESS_LIGHTS }, () => new THREE.Vector4()); // (offset, count, 0, 0)
  const roomPolyInfoNode = uniformArray<"vec4">(roomPolyInfo, "vec4");
  const roomPolyVerts = Array.from({ length: MAX_POSTPROCESS_LIGHTS * maxRoomPolyVerts }, () => new THREE.Vector2());
  const roomPolyVertsNode = uniformArray<"vec2">(roomPolyVerts, "vec2");

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
  function closestPointOnSegment2D(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
    const abx = bx - ax;
    const abz = bz - az;
    const abLenSq = abx * abx + abz * abz;
    const t = abLenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / abLenSq)) : 0;
    return { x: ax + abx * t, z: az + abz * t };
  }

  // CPU-side mirror of `roomClipFactor`'s ray-cast, for hit-testing clicks against the same
  // room-polygon `litAmount()` clips light slot `index` to. `count === 0` (unclipped) → always inside.
  function pointInRoomPoly2D(index: number, px: number, pz: number) {
    const info = roomPolyInfo[index];
    const count = info.y;
    if (count === 0) return true;
    const offset = info.x;
    let inside = false;
    for (let v = 0; v < count; v++) {
      const a = roomPolyVerts[offset + v];
      const b = roomPolyVerts[offset + ((v + 1) % count)];
      const yCross = a.y > pz !== b.y > pz;
      if (yCross) {
        const t = ((b.x - a.x) * (pz - a.y)) / (b.y - a.y) + a.x;
        if (px < t) inside = !inside;
      }
    }
    return inside;
  }

  // ray-cast point-in-polygon for a SINGLE light's room outline (single, non-nested Loop — used
  // by both `tracked` and `preview`, which are each exactly one light). 1 = inside room, or
  // unclipped (count == 0); 0 = outside.
  function singleRoomClipFactor(
    polyCount: THREE.UniformNode<"float", number>,
    polyVertsNode: ReturnType<typeof uniformArray<"vec2">>,
    px: THREE.Node<"float">,
    pz: THREE.Node<"float">,
  ) {
    const count = polyCount.toInt();
    const inside = int(0).toVar();

    If(count.greaterThan(0), () => {
      Loop(maxRoomPolyVerts, ({ i: v }) => {
        If(v.greaterThanEqual(count), () => {
          Break();
        });
        const a = polyVertsNode.element(v);
        const b = polyVertsNode.element(v.add(1).mod(count));
        // horizontal ray from (px, pz) in +x direction — XOR via float comparison
        const yCross = a.y.greaterThan(pz).toFloat().notEqual(b.y.greaterThan(pz).toFloat());
        const t = b.x.sub(a.x).mul(pz.sub(a.y)).div(b.y.sub(a.y)).add(a.x);
        If(yCross.and(px.lessThan(t)), () => {
          inside.assign(inside.bitXor(int(1)));
        });
      });
    });

    return count.equal(0).select(float(1), inside.toFloat());
  }

  // Same, but for static light slot `i`'s room outline, called from inside the per-light `Loop`
  // below. 🔔 the vertex scan is unrolled as plain `If`s (JS `for`), not a second `Loop` node —
  // nesting a dynamic `Loop` inside another `Loop` broke badly; nested `If`s are fine.
  function roomClipFactor(i: THREE.Node<"int">, px: THREE.Node<"float">, pz: THREE.Node<"float">) {
    const info = roomPolyInfoNode.element(i);
    const count = info.y.toInt();
    const inside = int(0).toVar();

    If(count.greaterThan(0), () => {
      const offset = info.x.toInt();
      for (let v = 0; v < maxRoomPolyVerts; v++) {
        If(int(v).lessThan(count), () => {
          const a = roomPolyVertsNode.element(offset.add(v));
          const b = roomPolyVertsNode.element(offset.add(int(v).add(1).mod(count)));
          // horizontal ray from (px, pz) in +x direction — XOR via float comparison
          const yCross = a.y.greaterThan(pz).toFloat().notEqual(b.y.greaterThan(pz).toFloat());
          const t = b.x.sub(a.x).mul(pz.sub(a.y)).div(b.y.sub(a.y)).add(a.x);
          If(yCross.and(px.lessThan(t)), () => {
            inside.assign(inside.bitXor(int(1)));
          });
        });
      }
    });

    return count.equal(0).select(float(1), inside.toFloat());
  }

  return {
    showBorder,
    setShowBorder(isShown) {
      showBorder.value = isShown ? 1 : 0;
    },
    lightsEnabled,
    setLightsEnabled(isEnabled) {
      lightsEnabled.value = isEnabled ? 1 : 0;
    },
    update(camera) {
      // ensure matrixWorld reflects this frame's position/orientation, not last frame's
      camera.updateMatrixWorld();
      camProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
      camWorldMatrix.value.copy(camera.matrixWorld);
      camPosition.value.copy(camera.position);
      // assumes a perspective camera (always true in this project) — needed to invert log depth
      const perspectiveCam = camera as THREE.PerspectiveCamera;
      camNear.value = perspectiveCam.near;
      camFar.value = perspectiveCam.far;
    },
    setTracked(center, radius) {
      if (center === null) {
        tracked.value.z = 0;
      } else {
        tracked.value.set(center.x, center.z, 1, radius ?? tracked.value.w);
      }
    },
    setTrackedRoomOutline(roomOutline) {
      const count = roomOutline ? Math.min(roomOutline.length, maxRoomPolyVerts) : 0;
      trackedRoomPolyCount.value = count;
      if (roomOutline) {
        for (let v = 0; v < count; v++) {
          trackedRoomPolyVerts[v].set(roomOutline[v].x, roomOutline[v].z);
        }
      }
    },
    setPreview(center, radius) {
      if (center === null) {
        preview.value.z = 0;
      } else {
        preview.value.set(center.x, center.z, 1, radius ?? preview.value.w);
      }
    },
    setPreviewRoomOutline(roomOutline) {
      const count = roomOutline ? Math.min(roomOutline.length, maxRoomPolyVerts) : 0;
      previewRoomPolyCount.value = count;
      if (roomOutline) {
        for (let v = 0; v < count; v++) {
          previewRoomPolyVerts[v].set(roomOutline[v].x, roomOutline[v].z);
        }
      }
    },
    addLight(point, radius, roomOutline) {
      const index = slots.findIndex((s) => s.z === 0);
      if (index === -1) return null;
      slots[index].set(point.x, point.z, 1, radius);

      const offset = index * maxRoomPolyVerts;
      const count = roomOutline ? Math.min(roomOutline.length, maxRoomPolyVerts) : 0;
      roomPolyInfo[index].set(offset, count, 0, 0);
      if (roomOutline) {
        for (let v = 0; v < count; v++) {
          roomPolyVerts[offset + v].set(roomOutline[v].x, roomOutline[v].z);
        }
      }

      recomputeHiWater();
      return index;
    },
    removeLight(index) {
      slots[index].set(0, 0, 0, 0);
      roomPolyInfo[index].set(0, 0, 0, 0);
      recomputeHiWater();
    },
    findLightNear(bottomXZ, topXZ, groundPoint) {
      let bestIndex = null as number | null;
      let bestDist = Infinity;
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i];
        if (s.z === 0) continue; // empty slot
        const closest = closestPointOnSegment2D(s.x, s.y, bottomXZ.x, bottomXZ.z, topXZ.x, topXZ.z);
        const dist = Math.hypot(s.x - closest.x, s.y - closest.z);
        // the room-poly check uses the actual ground click point, NOT the swept segment's
        // closest-point (an infinite-plane intersection unconstrained by walls, which can sweep
        // through an unrelated room and falsely satisfy that room's own light's clip)
        if (dist <= s.w && dist < bestDist && pointInRoomPoly2D(i, groundPoint.x, groundPoint.z)) {
          bestDist = dist;
          bestIndex = i;
        }
      }
      return bestIndex;
    },
    resetLights() {
      for (const s of slots) s.set(0, 0, 0, 0);
      for (const info of roomPolyInfo) info.set(0, 0, 0, 0);
      hiWater.value = 0;
      tracked.value.z = 0;
    },
    litAmount(sceneDepth) {
      return Fn(() => {
        const viewZ = logarithmicDepthToViewZ(sceneDepth, camNear, camFar);
        // depthWrite:false surfaces (e.g. the floor, see Floor.tsx) never populate the depth
        // buffer, reading back as far-plane — detect that and fall back to a ray/plane test.
        const isBackground = viewZ.negate().greaterThan(camFar.mul(0.99));

        // real `If/Else` (not `.select()`): these regions are large and screen-coherent, so most
        // GPU warps take one branch uniformly and skip the other entirely — `.select()` always
        // pays for both regardless of coherence.
        const worldXZ = vec2(0, 0).toVar();
        const worldY = float(0).toVar();

        If(isBackground, () => {
          // pick whichever height plane the ray is heading toward (down -> floor @ bottomHeight,
          // up -> topHeight) rather than assuming floor — matters for any other depthWrite:false
          // surface at a different height (the ceiling used to need this before it started
          // writing depth, see Ceiling.tsx)
          const viewDirPoint = getViewPosition(screenUV, float(0.5), camProjectionMatrixInverse);
          const worldDir = camWorldMatrix.mul(vec4(viewDirPoint, 0.0)).xyz.normalize();
          const planeHeight = worldDir.y.lessThan(0).select(float(bottomHeight), float(topHeight));
          const t = planeHeight.sub(camPosition.y).div(worldDir.y);
          worldXZ.assign(camPosition.add(worldDir.mul(t)).xz);
          worldY.assign(planeHeight);
        }).Else(() => {
          // reconstruct the real world position from depth (log-depth -> NDC -> view -> world) —
          // fixes lighting an npc that's actually in front of/behind the light's cylinder but
          // screen-aligned with it, which a plane-only test can't distinguish
          const ndcDepth = viewZToPerspectiveDepth(viewZ, camNear, camFar);
          const viewPos = getViewPosition(screenUV, ndcDepth, camProjectionMatrixInverse);
          const realWorldPos = camWorldMatrix.mul(vec4(viewPos, 1.0)).xyz;
          worldXZ.assign(realWorldPos.xz);
          worldY.assign(realWorldPos.y);
        });

        const inHeightRange = worldY.greaterThanEqual(float(bottomHeight)).and(worldY.lessThanEqual(float(topHeight)));

        const litMax = float(0).toVar();

        If(tracked.z.notEqual(0), () => {
          const dist = worldXZ.sub(tracked.xy).length();
          const litVal = float(1).sub(dist.sub(tracked.w).div(falloff).clamp(0, 1));
          const roomFactor = singleRoomClipFactor(trackedRoomPolyCount, trackedRoomPolyVertsNode, worldXZ.x, worldXZ.y);
          litMax.assign(litMax.max(inHeightRange.select(litVal.mul(roomFactor), float(0))));
        });

        If(preview.z.notEqual(0), () => {
          const dist = worldXZ.sub(preview.xy).length();
          const litVal = float(1).sub(dist.sub(preview.w).div(falloff).clamp(0, 1));
          const roomFactor = singleRoomClipFactor(previewRoomPolyCount, previewRoomPolyVertsNode, worldXZ.x, worldXZ.y);
          litMax.assign(litMax.max(inHeightRange.select(litVal.mul(roomFactor), float(0))));
        });

        Loop(MAX_POSTPROCESS_LIGHTS, ({ i }) => {
          If(i.greaterThanEqual(hiWater.toInt()), () => {
            Break();
          });
          const l = lightsNode.element(i);
          If(l.z.notEqual(0), () => {
            const dist = worldXZ.sub(l.xy).length();
            // l.w = this light's own radius
            const litVal = float(1).sub(dist.sub(l.w).div(falloff).clamp(0, 1));
            const roomFactor = roomClipFactor(i, worldXZ.x, worldXZ.y);
            litMax.assign(litMax.max(inHeightRange.select(litVal.mul(roomFactor), float(0))));
          });
        });

        // when lights are disabled, pretend none exist: nothing is lit, so the outside dim/tint
        // effect applies everywhere
        return lightsEnabled.equal(0).select(float(0), litMax);
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

        If(tracked.z.notEqual(0), () => {
          markIfOnWireframe(tracked.xy, tracked.w);
        });

        If(preview.z.notEqual(0), () => {
          markIfOnWireframe(preview.xy, preview.w);
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
