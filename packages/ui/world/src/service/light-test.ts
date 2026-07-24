import { geomorphKeys, type StarShipGeomorphKey } from "@npc-cli/media/starship-symbol";
import type { Mat } from "@npc-cli/util/geom";
import { drawPolygons } from "@npc-cli/util/service/canvas";
import {
  Fn,
  float,
  getViewPosition,
  If,
  Loop,
  logarithmicDepthToViewZ,
  screenUV,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
  viewZToPerspectiveDepth,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { TexArray } from "./tex-array";

export type RaycastLightPostprocessOpts = {
  /** World-space height (y) the light applies from. Default `0` */
  bottomHeight?: number;
  /** World-space height (y) the light applies up to */
  topHeight: number;
  /** World-space distance over which the light fades out, starting at its own radius. Default `0.6` */
  falloff?: number;
  /** Side length (px) of each gmKey's baked wall-occupancy texture layer. Default `256`. */
  wallTexSize?: number;
  /** Fixed number of samples along the npc-to-fragment line when testing wall occlusion. Default `24`. */
  marchSteps?: number;
};

export type RaycastLightPostprocess = {
  /** Feed the real scene camera (not the internal post-processing quad camera) */
  update(camera: THREE.Camera): void;

  /**
   * Positions the light — e.g. follows a live reference like `npc.position`. Pass `null` to
   * deactivate (center/radius left as last known, harmless while inactive). Omitting `radius`
   * while re-centering keeps the last radius set.
   */
  setTracked(center: { x: number; z: number } | null, radius?: number): void;

  /**
   * Bakes `gmKey`'s wall polygons (LOCAL geomorph space, e.g. `w.assets.layout[gmKey].walls`)
   * into a binary occupancy texture layer — once. Idempotent: a no-op if this gmKey was already
   * baked (walls are static, so this only needs to happen the first time a gmKey is encountered).
   */
  setGmWalls(gmKey: StarShipGeomorphKey, wallPolys: { outline: { x: number; y: number }[] }[], bounds: RectLike): void;

  /**
   * Registers which gm INSTANCE the tracked npc currently occupies — its gmKey (selects the
   * baked wall layer) and its world transform (so fragment/npc world positions can be converted
   * into that instance's local space for sampling). Call whenever the tracked npc's current gm
   * instance changes (not every frame) — mirrors the old system's "refresh on room-enter" cadence.
   *
   * 🚧 Phase A limitation: only ONE active gm instance is tracked at a time, so wall occlusion is
   * only correct within the npc's current instance — a fragment/march-step that maps outside its
   * bounds is treated as unoccluded (no wall data), not dark. Multi-instance sampling (needed for
   * occlusion that spans a doorway into a neighbouring instance) is a later refinement.
   */
  setActiveGm(gmKey: StarShipGeomorphKey, matrix: Mat): void;

  /**
   * `1` inside the light, fading to `0` over `falloff`; `0` if inactive, too far away, or if a
   * fixed-step march from the light to this fragment hits a wall texel first — tests each
   * fragment's reconstructed real world position (see impl. for why).
   * @param sceneDepth The scene's depth texture (e.g. `scenePass.getTextureNode("depth")`) — raw
   * logarithmic depth, NOT pre-linearized; this function does its own log-depth inversion.
   */
  litAmount(sceneDepth: THREE.Node<"float">): THREE.Node<"float">;

  /** Debug inspection only (see WorldMenu's "Light Map" debug modal) — not for production use */
  debug: {
    /** Baked wall-occupancy texture array, one layer per gmKey (index = `geomorphKeys.indexOf(gmKey)`) */
    wallTex: TexArray;
    /** gmKeys baked so far via `setGmWalls` — walls are static, so this only ever grows */
    bakedGmKeys(): StarShipGeomorphKey[];
    /** gmKey currently active for sampling (see `setActiveGm`), else `null` if never set */
    activeGmKey(): StarShipGeomorphKey | null;
  };
};

type RectLike = { x: number; y: number; width: number; height: number };

/**
 * Post-processing helper for a single vertical cylinder (axis along y, from `bottomHeight` to
 * `topHeight`) that follows a live target — e.g. `w.npc.trackNpc`. A PARALLEL alternative to
 * `tracked-light-postprocess.ts`'s room-based system: this one ignores rooms entirely and only
 * cares about wall polygons as occluders, tested via a fixed-step march through a baked
 * world-space texture rather than any per-frame polygon upload. Toggle between the two in
 * `WorldView.tsx`'s `setupPostProcessing` (mutually exclusive via `raycastLightEnabled`).
 *
 * Phase A (this file, current state): walls only, doors ignored (always "open"). Wall shape is
 * baked ONCE per gmKey (never re-baked — walls are static) into a binary occupancy `TexArray`
 * layer; `litAmount()` marches a fixed number of steps from the tracked position toward each
 * fragment, sampling that texture, and is occluded if any step lands on a wall texel. No JFA/SDF
 * yet (see `setGmWalls`'s doc) — a straightforward, lower-risk first cut to validate the toggle
 * and the overall texture-based approach before layering in doors and a proper distance field.
 */
export function createRaycastLightPostprocess(opts: RaycastLightPostprocessOpts): RaycastLightPostprocess {
  const falloff = opts.falloff ?? 0.6;
  const bottomHeight = opts.bottomHeight ?? 0;
  const topHeight = opts.topHeight;
  const wallTexSize = opts.wallTexSize ?? 512;
  const marchSteps = opts.marchSteps ?? 48;

  const camProjectionMatrixInverse = uniform(new THREE.Matrix4());
  const camWorldMatrix = uniform(new THREE.Matrix4());
  const camPosition = uniform(new THREE.Vector3());
  // needed to invert the real scene's logarithmic depth back into a world position (see litAmount)
  const camNear = uniform(0.1);
  const camFar = uniform(1000);

  // vec4(worldX, worldZ, activeFlag, radius)
  const tracked = uniform(new THREE.Vector4(0, 0, 0, 1));

  // one binary occupancy layer per gmKey (never re-baked — walls are static); "unbaked" layers
  // stay all-zero (transparent-black), which reads as "no wall" everywhere, harmless if ever
  // sampled before `setGmWalls` runs for that gmKey
  const wallTexArray = new TexArray({
    ctKey: "raycast-light-walls",
    numTextures: geomorphKeys.length,
    width: wallTexSize,
    height: wallTexSize,
  });
  const bakedGmKeys = new Set<StarShipGeomorphKey>();
  const boundsByGmKey = new Map<StarShipGeomorphKey, RectLike>();

  // which gm instance's wall layer/space is currently "active" (see `setActiveGm`'s doc re Phase
  // A's single-active-instance limitation)
  const activeLayer = uniform(0);
  // (bounds.x, bounds.y, uniformScale) — a SINGLE scale (not separate x/y factors) so non-square
  // gmKeys (e.g. an elongated bridge) aren't stretched to fill the square texture; must exactly
  // match the scale used to bake that layer in `setGmWalls`/`gmToTexScale`, else sampling reads
  // the wrong region
  const activeOriginScale = uniform(new THREE.Vector3());
  // world -> local affine, embedded as a 3x3 homogeneous matrix so TSL's mat3 multiply handles it
  const activeInverseTransform = uniform(new THREE.Matrix3());
  let activeGmKeySet: StarShipGeomorphKey | null = null;

  // uniform (aspect-preserving) scale fitting `bounds` within a `wallTexSize` square — shared by
  // both the bake (`setGmWalls`) and the sample (`sampleWallOccupied`) so they stay consistent
  function gmToTexScale(bounds: RectLike) {
    return Math.min(wallTexSize / bounds.width, wallTexSize / bounds.height);
  }

  // continuous (0..1) wall occupancy at world position (wx, wz), per the currently-active gm
  // instance's baked layer — deliberately NOT thresholded to a hard 0/1: the canvas bake already
  // anti-aliases each wall's edge over ~1 texel, and bilinear texture sampling smooths that
  // further, so keeping the raw value (rather than `.greaterThan(0.5)`) is what actually softens
  // the shadow edge instead of collapsing it back to a jagged binary cutoff. Out-of-bounds
  // (outside the active instance, or the unused margin of a non-square gmKey) reads as `0` (no
  // wall) — see `setActiveGm`'s doc.
  function sampleWallOccupancy(wx: THREE.Node<"float">, wz: THREE.Node<"float">) {
    const local = activeInverseTransform.mul(vec3(wx, wz, 1));
    const u = local.x.sub(activeOriginScale.x).mul(activeOriginScale.z).div(wallTexSize);
    const v = local.y.sub(activeOriginScale.y).mul(activeOriginScale.z).div(wallTexSize);
    const inBounds = u.greaterThanEqual(0).and(u.lessThanEqual(1)).and(v.greaterThanEqual(0)).and(v.lessThanEqual(1));
    const occupancy = texture(wallTexArray.tex, vec2(u, v)).depth(activeLayer).r;
    return inBounds.select(occupancy, float(0));
  }

  return {
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
    setGmWalls(gmKey, wallPolys, bounds) {
      if (bakedGmKeys.has(gmKey)) {
        return;
      }
      bakedGmKeys.add(gmKey);
      boundsByGmKey.set(gmKey, bounds);

      const layerIndex = geomorphKeys.indexOf(gmKey);
      if (layerIndex === -1) {
        return;
      }

      const { ct } = wallTexArray;
      ct.resetTransform();
      ct.clearRect(0, 0, ct.canvas.width, ct.canvas.height);
      // uniform scale (not separate x/y factors) preserves aspect ratio — a non-square gmKey
      // (e.g. an elongated bridge) leaves unused margin rather than being stretched to fill
      const scale = gmToTexScale(bounds);
      ct.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale);
      drawPolygons(ct, wallPolys as Geom.Poly[], { fillStyle: "white" });
      wallTexArray.updateIndex(layerIndex);
    },
    setActiveGm(gmKey, matrix) {
      const layerIndex = geomorphKeys.indexOf(gmKey);
      const bounds = boundsByGmKey.get(gmKey);
      if (layerIndex === -1 || !bounds) {
        return; // not yet baked via `setGmWalls` — ignore until it is
      }
      activeLayer.value = layerIndex;
      activeOriginScale.value.set(bounds.x, bounds.y, gmToTexScale(bounds));
      const inv = matrix.getInverseMatrix();
      // biome-ignore format: row-major (a,c,e / b,d,f / 0,0,1) matches THREE.Matrix3.set's argument order
      activeInverseTransform.value.set(inv.a, inv.c, inv.e, inv.b, inv.d, inv.f, 0, 0, 1);
      activeGmKeySet = gmKey;
    },
    litAmount(sceneDepth) {
      return Fn(() => {
        const viewZ = logarithmicDepthToViewZ(sceneDepth, camNear, camFar);
        // depthWrite:false surfaces (e.g. the floor, see Floor.tsx) never populate the depth
        // buffer, reading back as far-plane — detect that and fall back to a ray/plane test.
        const isBackground = viewZ.negate().greaterThan(camFar.mul(0.99));

        const worldXZ = vec2(0, 0).toVar();
        const worldY = float(0).toVar();

        If(isBackground, () => {
          // pick whichever height plane the ray is heading toward (down -> floor @ bottomHeight,
          // up -> topHeight) rather than assuming floor
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

        const litOut = float(0).toVar();
        If(tracked.z.notEqual(0).and(inHeightRange), () => {
          // distance first, cheaply — skips the march loop below entirely for the vast majority
          // of fragments (anything out of the light's reach)
          const dist = worldXZ.sub(tracked.xy).length();
          const litVal = float(1).sub(dist.sub(tracked.w).div(falloff).clamp(0, 1));

          If(litVal.greaterThan(0), () => {
            // fixed-step march from the tracked position toward this fragment, taking the
            // MAXIMUM (continuous) wall occupancy seen along the way rather than a binary
            // hit/miss (see `sampleWallOccupancy`'s doc) — using a fixed fractional step count
            // (not a fixed world-space step size) keeps sample positions continuous
            // frame-to-frame; tying step size to world-space distance instead caused visible
            // jitter, since the exact positions then shifted discontinuously as distance changed.
            const maxOccupancy = float(0).toVar();
            Loop(marchSteps, ({ i }) => {
              const t = float(i).add(1).div(float(marchSteps));
              const stepX = tracked.x.add(worldXZ.x.sub(tracked.x).mul(t));
              const stepZ = tracked.y.add(worldXZ.y.sub(tracked.y).mul(t));
              maxOccupancy.assign(maxOccupancy.max(sampleWallOccupancy(stepX, stepZ)));
            });

            litOut.assign(litVal.mul(float(1).sub(maxOccupancy.clamp(0, 1))));
          });
        });

        return litOut;
      })();
    },
    debug: {
      wallTex: wallTexArray,
      bakedGmKeys: () => Array.from(bakedGmKeys),
      activeGmKey: () => activeGmKeySet,
    },
  };
}
