import { geomorphKeys, type StarShipGeomorphKey } from "@npc-cli/media/starship-symbol";
import type { Mat } from "@npc-cli/util/geom";
import { tryLocalStorageGetParsed, tryLocalStorageSet } from "@npc-cli/util/legacy/generic";
import { drawPolygons } from "@npc-cli/util/service/canvas";
import {
  Break,
  Fn,
  float,
  getViewPosition,
  If,
  int,
  Loop,
  logarithmicDepthToViewZ,
  rtt,
  screenUV,
  texture,
  uniform,
  uniformArray,
  uv,
  vec2,
  vec3,
  vec4,
  viewZToPerspectiveDepth,
} from "three/tsl";
import * as THREE from "three/webgpu";
import {
  defaultDynamicLightIntensity,
  defaultDynamicLightRadius,
  dynamicLightIntensityKey,
  dynamicLightRadiusKey,
} from "../const";
import { TexArray } from "./tex-array";

export type DynamicLightPostprocessOpts = {
  /** Fixed number of samples along the npc-to-fragment line when testing wall occlusion. Default `24`. */
  marchSteps: number;
  /** World-space height (y) the light applies from. Default `0` */
  bottomHeight?: number;
  /** World-space height (y) the light applies up to */
  topHeight: number;
  /** World-space distance over which the light fades out, starting at its own radius. Default `0.6` */
  falloff?: number;
  /** Side length (px) of each gmKey's baked wall-occupancy texture layer. Default `256`. */
  wallTexSize?: number;
  /** World-space half-depth used when stroking a door's currently-closed portion onto its mask. Default `0.1`. */
  doorHalfDepth?: number;
  /** Radius used while the tracked npc is near a hull door (see `setNearHullDoor`). Default `0.8`. */
  hullDoorwayRadius?: number;
  /** Per-second lerp speed for animating towards/away from `hullDoorwayRadius`. Default `4`. */
  hullDoorwayLerpSpeed?: number;
};

export type DynamicLightPostprocess = {
  /** Live reference of the world position this light follows; `null` deactivates it */
  displayCenter: THREE.Vector3;
  /** Set by `w.npc.trackNpc`; a live reference (e.g. `npc.position`), not a snapshot. `null` means off. */
  target: null | { x: number; y: number; z: number };
  /** Set by `w.npc.trackNpc`; lets `"enter-room"`/`"spawned"` know which npc's gm-transitions should refresh this light */
  trackedNpcKey: null | string;
  /** Persisted radius, settable via `setRadius` */
  radius: number;
  /** Encoded (gmId, doorId) of every door in the tracked npc's current gm instance, written by `setActiveGmDoors` */
  activeGmDoorInstanceIds: number[];
  /** Persisted brightness multiplier uniform */
  intensity: THREE.UniformNode<"float", number>;

  /** Feed the real scene camera (not the internal post-processing quad camera) */
  update(camera: THREE.Camera): void;

  /** Positions the light (e.g. follows `npc.position`). `null` deactivates. */
  setTracked(center: { x: number; z: number } | null, radius?: number): void;

  /** Sets the persisted radius; pushes it to `setTracked` immediately if currently tracking */
  setRadius(next: number): void;

  /** Sets the persisted brightness multiplier */
  setIntensity(next: number): void;

  /**
   * Shrinks (or restores) the effective radius, animated — call with `true` when the tracked npc
   * is near ANY hull door (only one gm instance is ever "active" for occlusion, so a full-size
   * light near a hull door can otherwise leak into an adjacent, unoccluded gm instance), `false`
   * once it's no longer near any (not necessarily the same door it entered near).
   */
  setNearHullDoor(near: boolean): void;

  /** Advances the hull-doorway radius animation. Call every tick (e.g. from `World.onTick`). */
  tick(deltaSeconds: number): void;

  /** Bakes `gmKey`'s wall polygons (local space) into an occupancy texture layer, once. */
  setGmWalls(
    gmKey: StarShipGeomorphKey,
    wallPolys: { outline: { x: number; y: number }[] }[],
    bounds: Geom.RectJson,
  ): void;

  /**
   * Sets which gm instance the tracked npc currently occupies. Call on room change.
   * 🚧 Only one active instance at a time — occlusion outside it reads as unoccluded.
   */
  setActiveGm(gmKey: StarShipGeomorphKey, matrix: Mat): void;

  /**
   * Registers the active instance's doors (local space, geometry only), cached per `gmKey` (a
   * no-op if `gmKey` is already active). `gapAtHighLambda`: gap grows back from `seg[1]` if
   * `true`, from `seg[0]` if `false` (matches `Doors.tsx`).
   */
  setActiveGmDoors(
    gmKey: StarShipGeomorphKey,
    doors: {
      seg: [{ x: number; y: number }, { x: number; y: number }];
      gapAtHighLambda: boolean;
      instanceId: number;
    }[],
  ): void;

  /** Live open ratio per door from `setActiveGmDoors` (same order). Call every frame. */
  setActiveGmDoorRatios(ratios: number[]): void;

  /**
   * `1` inside the light, fading to `0` over `falloff`; `0` if occluded.
   * @param sceneDepth Raw logarithmic depth (not pre-linearized).
   */
  litAmount(sceneDepth: THREE.Node<"float">): THREE.Node<"float">;

  /** Debug inspection only (see WorldMenu's "Light Map" modal) */
  debug: {
    wallTex: TexArray;
    bakedGmKeys(): StarShipGeomorphKey[];
    activeGmKey(): StarShipGeomorphKey | null;
  };
};

/** Ignores rooms, occludes only against baked wall/door textures via a fixed-step march. */
export function createDynamicLightPostprocess(opts: DynamicLightPostprocessOpts): DynamicLightPostprocess {
  const falloff = opts.falloff ?? 0.5;
  const bottomHeight = opts.bottomHeight ?? 0;
  const topHeight = opts.topHeight;
  const wallTexSize = opts.wallTexSize ?? 512;
  const marchSteps = opts.marchSteps;
  const doorHalfDepth = opts.doorHalfDepth ?? 0.1;
  const hullDoorwayRadius = opts.hullDoorwayRadius ?? 0.5;
  const hullDoorwayLerpSpeed = opts.hullDoorwayLerpSpeed ?? 4;

  // read fresh from localStorage at creation time — `dynamicLight` is fully recreated on HMR
  const initialRadius = tryLocalStorageGetParsed<number>(dynamicLightRadiusKey) ?? defaultDynamicLightRadius;
  const initialIntensity = tryLocalStorageGetParsed<number>(dynamicLightIntensityKey) ?? defaultDynamicLightIntensity;

  const camProjectionMatrixInverse = uniform(new THREE.Matrix4());
  const camWorldMatrix = uniform(new THREE.Matrix4());
  const camPosition = uniform(new THREE.Vector3());
  const camNear = uniform(0.1);
  const camFar = uniform(1000);

  // vec4(worldX, worldZ, activeFlag, radius)
  const tracked = uniform(new THREE.Vector4(0, 0, 0, 1));
  // animated towards (near a hull door ? min(radius, hullDoorwayRadius) : radius) each tick
  let effectiveRadius = initialRadius;
  let nearHullDoor = false;

  // one occupancy layer per gmKey, baked once (walls are static)
  const wallTexArray = new TexArray({
    ctKey: "raycast-light-walls",
    numTextures: geomorphKeys.length,
    width: wallTexSize,
    height: wallTexSize,
  });
  const bakedGmKeys = new Set<StarShipGeomorphKey>();
  const boundsByGmKey = new Map<StarShipGeomorphKey, Geom.RectJson>();

  // active gm instance's doors, local space, oriented so the gap grows a->b (rare writes).
  // 🔔 hard cap: any door beyond this in a gm instance's door list is silently unregistered (never
  // occludes) — the old canvas-based mask had no such cap. Current worst case is exactly 32
  // (g-101--multipurpose, g-301--bridge — see assets.json), so this needs real headroom above that.
  const maxActiveDoors = 40;
  const doorSegs = Array.from({ length: maxActiveDoors }, () => new THREE.Vector4());
  const doorSegsNode = uniformArray<"vec4">(doorSegs, "vec4");
  // live open ratio per door slot, written every frame something changes; -1 = inactive slot
  const doorOpenRatioValues = new Array<number>(maxActiveDoors).fill(-1);
  const doorOpenRatio = uniformArray<"float">(doorOpenRatioValues, "float");
  let activeDoorCount = 0;
  // last ratios actually pushed to the GPU, for the "did anything change enough" check
  let lastDoorRatios: number[] = new Array(maxActiveDoors).fill(-1);
  // gmKey last passed to setActiveGmDoors — re-orienting/resetting is a no-op if unchanged
  let lastActiveDoorsGmKey: StarShipGeomorphKey | null = null;

  // (bounds.x, bounds.y, uniformScale, layerIndex) — uniform scale keeps non-square gmKeys unstretched
  const activeOrigin = uniform(new THREE.Vector4());
  // world -> local affine, as a 3x3 homogeneous matrix
  const activeInverseTransform = uniform(new THREE.Matrix3());
  let activeGmKeySet: StarShipGeomorphKey | null = null;

  // aspect-preserving scale fitting `bounds` into a `wallTexSize` square
  function gmToTexScale(bounds: Geom.RectJson) {
    return Math.min(wallTexSize / bounds.width, wallTexSize / bounds.height);
  }

  // clamped nearest point on segment (ax,az)-(bx,bz) to (px,pz)
  function nearestPointOnSegment(
    px: THREE.Node<"float">,
    pz: THREE.Node<"float">,
    ax: THREE.Node<"float">,
    az: THREE.Node<"float">,
    bx: THREE.Node<"float">,
    bz: THREE.Node<"float">,
  ) {
    const abx = bx.sub(ax);
    const abz = bz.sub(az);
    const t = px
      .sub(ax)
      .mul(abx)
      .add(pz.sub(az).mul(abz))
      .div(abx.mul(abx).add(abz.mul(abz)))
      .clamp(0, 1);
    return { x: ax.add(abx.mul(t)), z: az.add(abz.mul(t)) };
  }

  // renders the wall layer + live doors into one texture, sampled per march step (see combinedTex)
  const computeCombinedOccupancy = Fn(() => {
    const localUv = uv();
    const wallSample = texture(wallTexArray.tex, localUv).depth(activeOrigin.w).r;
    const localX = activeOrigin.x.add(localUv.x.mul(wallTexSize).div(activeOrigin.z));
    const localZ = activeOrigin.y.add(localUv.y.mul(wallTexSize).div(activeOrigin.z));

    const doorOccupancy = float(0).toVar();
    for (let slot = 0; slot < maxActiveDoors; slot++) {
      const ratio = doorOpenRatio.element(int(slot));
      If(ratio.greaterThanEqual(0), () => {
        const seg = doorSegsNode.element(int(slot));
        // closed sub-segment [lerp(a,b,ratio), b] — gap already oriented to grow a->b
        const c0x = seg.x.add(seg.z.sub(seg.x).mul(ratio));
        const c0z = seg.y.add(seg.w.sub(seg.y).mul(ratio));
        const nearest = nearestPointOnSegment(localX, localZ, c0x, c0z, seg.z, seg.w);
        const dist = localX.sub(nearest.x).pow(2).add(localZ.sub(nearest.z).pow(2)).sqrt();
        const occ = float(1).sub(dist.div(doorHalfDepth).clamp(0, 1));
        doorOccupancy.assign(doorOccupancy.max(occ));
      });
    }

    return vec4(wallSample.max(doorOccupancy), 0, 0, 1);
  });
  const combinedTex = rtt(computeCombinedOccupancy(), wallTexSize, wallTexSize);
  combinedTex.autoUpdate = false;

  // continuous (unthresholded) occupancy so shadow edges stay soft, not jagged
  function sampleOccupancy(wx: THREE.Node<"float">, wz: THREE.Node<"float">) {
    const local = activeInverseTransform.mul(vec3(wx, wz, 1));
    const u = local.x.sub(activeOrigin.x).mul(activeOrigin.z).div(wallTexSize);
    const v = local.y.sub(activeOrigin.y).mul(activeOrigin.z).div(wallTexSize);
    const inBounds = u.greaterThanEqual(0).and(u.lessThanEqual(1)).and(v.greaterThanEqual(0)).and(v.lessThanEqual(1));
    return inBounds.select(texture(combinedTex, vec2(u, v)).r, float(0));
  }

  return {
    displayCenter: new THREE.Vector3(),
    target: null,
    trackedNpcKey: null,
    radius: initialRadius,
    activeGmDoorInstanceIds: [],
    intensity: uniform(initialIntensity),

    update(camera) {
      camera.updateMatrixWorld();
      camProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
      camWorldMatrix.value.copy(camera.matrixWorld);
      camPosition.value.copy(camera.position);
      const perspectiveCam = camera as THREE.PerspectiveCamera;
      camNear.value = perspectiveCam.near;
      camFar.value = perspectiveCam.far;
    },
    setTracked(center, radius) {
      if (center === null) {
        tracked.value.z = 0;
      } else {
        tracked.value.set(center.x, center.z, 1, radius ?? tracked.value.w);
        if (radius !== undefined) {
          effectiveRadius = radius;
        }
      }
    },
    setRadius(next) {
      this.radius = next;
      tryLocalStorageSet(dynamicLightRadiusKey, String(next));
      if (this.target !== null) {
        // instant, not animated — a slider drag should feel responsive; hull-door capping still applies
        this.setTracked(
          { x: this.displayCenter.x, z: this.displayCenter.z },
          nearHullDoor ? Math.min(next, hullDoorwayRadius) : next,
        );
      }
    },
    setIntensity(next) {
      this.intensity.value = next;
      tryLocalStorageSet(dynamicLightIntensityKey, String(next));
    },
    setNearHullDoor(near) {
      nearHullDoor = near;
    },
    tick(deltaSeconds) {
      const targetRadius = Math.min(this.radius, nearHullDoor ? hullDoorwayRadius : this.radius);
      const lerpAmt = Math.min(1, deltaSeconds * hullDoorwayLerpSpeed);
      effectiveRadius += (targetRadius - effectiveRadius) * lerpAmt;
      if (this.target !== null) {
        tracked.value.w = effectiveRadius;
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
      const scale = gmToTexScale(bounds);
      ct.setTransform(scale, 0, 0, scale, -bounds.x * scale, -bounds.y * scale);
      drawPolygons(ct, wallPolys as Geom.Poly[], { fillStyle: "white", strokeStyle: null });
      wallTexArray.updateIndex(layerIndex);
      combinedTex.textureNeedsUpdate = true;
    },
    setActiveGm(gmKey, matrix) {
      const layerIndex = geomorphKeys.indexOf(gmKey);
      const bounds = boundsByGmKey.get(gmKey);
      if (layerIndex === -1 || !bounds) {
        return; // not yet baked
      }
      activeOrigin.value.set(bounds.x, bounds.y, gmToTexScale(bounds), layerIndex);
      const inv = matrix.getInverseMatrix();
      // biome-ignore format: row-major (a,c,e / b,d,f / 0,0,1)
      activeInverseTransform.value.set(inv.a, inv.c, inv.e, inv.b, inv.d, inv.f, 0, 0, 1);
      activeGmKeySet = gmKey;
      combinedTex.textureNeedsUpdate = true;
    },
    setActiveGmDoors(gmKey, doors) {
      if (gmKey === lastActiveDoorsGmKey) {
        return; // door list for a gmKey is static — nothing changed
      }
      lastActiveDoorsGmKey = gmKey;
      activeDoorCount = Math.min(doors.length, maxActiveDoors);
      for (let i = 0; i < activeDoorCount; i++) {
        const { seg, gapAtHighLambda } = doors[i];
        // orient so the passable gap always grows a->b
        const [a, b] = gapAtHighLambda ? [seg[1], seg[0]] : [seg[0], seg[1]];
        doorSegs[i].set(a.x, a.y, b.x, b.y);
      }
      // -1 marks every slot inactive until the next setActiveGmDoorRatios call
      doorOpenRatioValues.fill(-1);
      lastDoorRatios = new Array(maxActiveDoors).fill(-1);
      this.activeGmDoorInstanceIds = doors.slice(0, activeDoorCount).map((d) => d.instanceId);
      combinedTex.textureNeedsUpdate = true;
    },
    setActiveGmDoorRatios(ratios) {
      let changed = false;
      for (let i = 0; i < activeDoorCount; i++) {
        if (Math.abs((ratios[i] ?? 0) - lastDoorRatios[i]) > 0.01) {
          changed = true;
          break;
        }
      }
      if (!changed) {
        return;
      }
      for (let i = 0; i < activeDoorCount; i++) {
        const ratio = ratios[i] ?? 0;
        lastDoorRatios[i] = ratio;
        doorOpenRatioValues[i] = ratio;
      }
      combinedTex.textureNeedsUpdate = true;
    },
    litAmount(sceneDepth) {
      return Fn(() => {
        const viewZ = logarithmicDepthToViewZ(sceneDepth, camNear, camFar);
        // depthWrite:false surfaces (e.g. floor) read back as far-plane
        const isBackground = viewZ.negate().greaterThan(camFar.mul(0.99));

        const worldXZ = vec2(0, 0).toVar();
        const worldY = float(0).toVar();

        If(isBackground, () => {
          const viewDirPoint = getViewPosition(screenUV, float(0.5), camProjectionMatrixInverse);
          const worldDir = camWorldMatrix.mul(vec4(viewDirPoint, 0.0)).xyz.normalize();
          const planeHeight = worldDir.y.lessThan(0).select(float(bottomHeight), float(topHeight));
          const t = planeHeight.sub(camPosition.y).div(worldDir.y);
          worldXZ.assign(camPosition.add(worldDir.mul(t)).xz);
          worldY.assign(planeHeight);
        }).Else(() => {
          const ndcDepth = viewZToPerspectiveDepth(viewZ, camNear, camFar);
          const viewPos = getViewPosition(screenUV, ndcDepth, camProjectionMatrixInverse);
          const realWorldPos = camWorldMatrix.mul(vec4(viewPos, 1.0)).xyz;
          worldXZ.assign(realWorldPos.xz);
          worldY.assign(realWorldPos.y);
        });

        const inHeightRange = worldY.greaterThanEqual(float(bottomHeight)).and(worldY.lessThanEqual(float(topHeight)));

        const litOut = float(0).toVar();
        If(tracked.z.notEqual(0).and(inHeightRange), () => {
          const dist = worldXZ.sub(tracked.xy).length();
          const litVal = float(1).sub(dist.sub(tracked.w).div(falloff).clamp(0, 1));

          If(litVal.greaterThan(0), () => {
            // fixed step COUNT (not step size) — keeps sample positions continuous frame-to-frame
            const maxOccupancy = float(0).toVar();
            Loop(marchSteps, ({ i }) => {
              const t = float(i).add(1).div(float(marchSteps));
              const stepX = tracked.x.add(worldXZ.x.sub(tracked.x).mul(t));
              const stepZ = tracked.y.add(worldXZ.y.sub(tracked.y).mul(t));
              maxOccupancy.assign(maxOccupancy.max(sampleOccupancy(stepX, stepZ)));
              If(maxOccupancy.greaterThanEqual(0.75), () => {
                maxOccupancy.assign(1);
                Break();
              });
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
