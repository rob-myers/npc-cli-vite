import {
  Break,
  Fn,
  float,
  fwidth,
  getViewPosition,
  If,
  int,
  Loop,
  logarithmicDepthToViewZ,
  rtt,
  screenUV,
  smoothstep,
  texture,
  uniform,
  uniformArray,
  uv,
  vec2,
  vec4,
  viewZToPerspectiveDepth,
} from "three/tsl";
import * as THREE from "three/webgpu";
import {
  defaultDynamicLightIntensity,
  defaultDynamicLightRadius,
  defaultDynamicLightTint,
  lightTileSize,
  maxDynamicLightRadius,
} from "../const";
import { getContext2d } from "./tex-array";

export type DynamicLightPostprocessOpts = {
  /**
   * Maximum number of samples along the npc-to-fragment line when testing wall occlusion,
   * calibrated against the worst-case light-to-fragment distance (max slider radius `3` + `falloff`)
   * to derive a fixed world-space step size — closer fragments take fewer, not smaller, steps.
   * Default `24`.
   */
  marchSteps: number;
  /** World-space height (y) the light applies from. Default `0` */
  bottomHeight?: number;
  /** World-space height (y) the light applies up to */
  topHeight: number;
  /** World-space distance over which the light fades out, starting at its own radius. Default `0.9` */
  falloff?: number;
  /** Side length (px) of the world-space wall-occupancy texture. Default `512`. */
  wallTexSize?: number;
  /** World-space half-depth used when stroking a door's currently-closed portion onto its mask. Default `0.05`. */
  doorHalfDepth?: number;
  /** Initial radius, persisted by the caller. Default `defaultDynamicLightRadius` */
  radius?: number;
  /** Initial brightness multiplier, persisted by the caller. Default `defaultDynamicLightIntensity` */
  intensity?: number;
};

export type DynamicLightPostprocess = {
  /** Live reference of the world position this light follows; `null` deactivates it */
  displayCenter: THREE.Vector3;
  /** Persisted radius, settable via `setRadius` */
  radius: number;
  /** Encoded (gmId, doorId) of every door currently occupying a slot, in slot order — see `setDoors` */
  doorInstanceIds: number[];
  /** Persisted brightness multiplier uniform */
  intensity: THREE.UniformNode<"float", number>;
  /** What its ground polygon is washed with, inside its outline — see `WorldView` */
  tint: THREE.UniformNode<"color", THREE.Color>;

  /** Feed the real scene camera (not the internal post-processing quad camera) */
  update(camera: THREE.Camera): void;

  /** Positions the light (e.g. follows `npc.position`). `null` deactivates. */
  setTracked(center: { x: number; z: number } | null, radius?: number): void;

  /** Sets the persisted radius; pushes it to `setTracked` immediately if currently tracking */
  setRadius(next: number): void;

  /** Sets the persisted brightness multiplier */
  setIntensity(next: number): void;

  /** The window's width in metres — it spans whatever geomorphs it covers */
  tileWorldSize: number;

  /**
   * Where the occupancy window should sit for a light at `(x, z)`, or `null` if it already sits
   * there and `force` is not set.
   */
  nextTileOrigin(x: number, z: number, force?: boolean): { originX: number; originZ: number } | null;

  /**
   * Starts redrawing the window at that origin, returning a canvas context already transformed
   * from WORLD coordinates — draw walls white. Finish with `endTile`, which swaps it in.
   */
  beginTile(originX: number, originZ: number): CanvasRenderingContext2D;

  /** Uploads what `beginTile` drew and points sampling at it */
  endTile(): void;

  /**
   * The doors close enough to the light to matter, in world space. `gapAtHighLambda`: the gap
   * grows back from `dst` if `true`, from `src` if `false` (matches `Doors.tsx`).
   */
  setDoors(
    doors: {
      src: { x: number; y: number };
      dst: { x: number; y: number };
      gapAtHighLambda: boolean;
      instanceId: number;
    }[],
  ): void;

  /** Live open ratio per door from `setDoors` (same order). Call every frame. */
  setDoorRatios(ratios: ArrayLike<number>): void;

  /**
   * Coverage of the ground polygon the tracked npc can see — `1` within it, `0` without, with
   * a pixel of easing between.
   * @param sceneDepth Raw logarithmic depth (not pre-linearized).
   */
  litPolygon(sceneDepth: THREE.Node<"float">): THREE.Node<"float">;

  /** Debug inspection only (see WorldMenu's "Light Map" modal) */
  debug: {
    wallTexSize: number;
    wallCanvas: HTMLCanvasElement;
    tileOrigin(): { originX: number; originZ: number } | null;
  };
};

/** Ignores rooms, occludes only against baked wall/door textures via a fixed-step march. */
export function createDynamicLightPostprocess(opts: DynamicLightPostprocessOpts): DynamicLightPostprocess {
  const falloff = opts.falloff ?? 0.6;
  const bottomHeight = opts.bottomHeight ?? 0;
  const topHeight = opts.topHeight;
  const wallTexSize = opts.wallTexSize ?? 512;
  const marchSteps = opts.marchSteps;
  // worst-case light-to-fragment distance ever marched (max slider radius + falloff) — used to
  // derive a fixed world-space step size so sampling density no longer degrades with distance from
  // the light (a fixed step COUNT alone spreads over a longer `dist` far from the light, causing
  // wavy/bumpy shadow edges near the light's outer radius).
  const marchStepSize = (maxDynamicLightRadius + falloff) / marchSteps;
  // 🔔 too small => bands on floor, too big => partially lit door (other side)
  const doorHalfDepth = opts.doorHalfDepth ?? 0.08; // small enough to light
  // the march must stop this far short of the fragment itself — otherwise a fragment ON a door's
  // own surface (which sits right on that door's own occlusion segment) always self-samples its own
  // occlusion stroke and reads as fully occluded regardless of the light's radius/falloff.
  const marchSurfaceBias = doorHalfDepth;
  /** How far above `bottomHeight` still counts as the floor — see `litPolygon` */
  const groundEpsilon = 0.05;
  /** The window is this many metres square, covering the light plus a whole tile margin */
  const tileWorldSize = lightTileSize * 3;

  // persisted by `WorldView`, which owns the world's store
  const initialRadius = opts.radius ?? defaultDynamicLightRadius;
  const initialIntensity = opts.intensity ?? defaultDynamicLightIntensity;

  const camProjectionMatrixInverse = uniform(new THREE.Matrix4());
  const camWorldMatrix = uniform(new THREE.Matrix4());
  const camPosition = uniform(new THREE.Vector3());
  const camNear = uniform(0.1);
  const camFar = uniform(1000);

  // vec4(worldX, worldZ, activeFlag, radius)
  const tracked = uniform(new THREE.Vector4(0, 0, 0, 1));

  // walls of every instance the window covers, drawn in WORLD space. A `CanvasTexture` rather
  // than a `DataTexture` over `getImageData`: three uploads the canvas itself with
  // `copyExternalImageToTexture`, so nothing is read back into JS and the canvas can stay
  // GPU-backed — hence no `willReadFrequently`, which would forfeit accelerated fills
  const wallCt = getContext2d("dynamic-light-walls");
  wallCt.canvas.width = wallTexSize;
  wallCt.canvas.height = wallTexSize;
  const wallTex = new THREE.CanvasTexture(wallCt.canvas);
  wallTex.magFilter = THREE.NearestFilter;
  wallTex.minFilter = THREE.NearestFilter;
  wallTex.flipY = false; // texel v grows with world z, as `sampleOccupancy` assumes

  /** World position of the window's min corner, and the tile it is centred on */
  const tileOrigin = uniform(new THREE.Vector2(0, 0));
  let tileCenter: null | { tileX: number; tileZ: number } = null;
  let pendingOrigin: null | { originX: number; originZ: number } = null;

  // the doors near the light's window, world space, oriented so the gap grows a->b (rare writes).
  // 🔔 a slot budget rather than a per-geomorph cap: `setDoors` registers only the doors that
  // could matter from somewhere in the window's middle tile, so this needs headroom over that
  // rather than over the ~39 doors a single geomorph can hold
  const maxActiveDoors = 40;
  const doorSegs = Array.from({ length: maxActiveDoors }, () => new THREE.Vector4());
  const doorSegsNode = uniformArray<"vec4">(doorSegs, "vec4");
  // live open ratio per door slot, written every frame something changes; -1 = inactive slot
  const doorOpenRatioValues = new Array<number>(maxActiveDoors).fill(-1);
  const doorOpenRatio = uniformArray<"float">(doorOpenRatioValues, "float");
  let activeDoorCount = 0;
  // last ratios actually pushed to the GPU, for the "did anything change enough" check
  let lastDoorRatios: number[] = new Array(maxActiveDoors).fill(-1);

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
    const wallSample = texture(wallTex, localUv).r;
    const localX = tileOrigin.x.add(localUv.x.mul(tileWorldSize));
    const localZ = tileOrigin.y.add(localUv.y.mul(tileWorldSize));

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
    const u = wx.sub(tileOrigin.x).div(tileWorldSize);
    const v = wz.sub(tileOrigin.y).div(tileWorldSize);
    // a safety net rather than a routine path: the light sits in the middle tile, so the window
    // reaches a whole `lightTileSize` beyond anywhere the march can go
    const inTile = u.greaterThanEqual(0).and(u.lessThanEqual(1)).and(v.greaterThanEqual(0)).and(v.lessThanEqual(1));
    return inTile.select(texture(combinedTex, vec2(u, v)).r, float(1));
  }

  return {
    tileWorldSize,
    debug: {
      wallTexSize,
      wallCanvas: wallCt.canvas,
      tileOrigin: () => (tileCenter === null ? null : { originX: tileOrigin.value.x, originZ: tileOrigin.value.y }),
    },
    displayCenter: new THREE.Vector3(),
    radius: initialRadius,
    doorInstanceIds: [],
    intensity: uniform(initialIntensity),
    tint: uniform(new THREE.Color(defaultDynamicLightTint)),

    litPolygon(sceneDepth) {
      const reachNode = Fn(() => {
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

        // the floor alone: this reads as a shape lying there, not as light falling on things
        const onGround = worldY.lessThanEqual(float(bottomHeight).add(groundEpsilon));

        const reach = float(0).toVar();

        If(tracked.z.notEqual(0).and(onGround), () => {
          const dist = worldXZ.sub(tracked.xy).length();
          const span = tracked.w.add(falloff);
          // uniform fade from the tracked npc out to the edge, rather than a flat core
          const litVal = float(1).sub(dist.div(span).clamp(0, 1));

          If(litVal.greaterThan(0), () => {
            // step positions stay a FRACTION of this ray's own `dist` (like the original fixed-count
            // march) rather than fixed absolute distances from the light — sampling at fixed absolute
            // distances put every ray's samples on the same set of concentric circles around the
            // light, which showed up as ridges banding across walls/doors. Instead the STEP COUNT
            // itself scales with `dist` (capped at `marchSteps`) so the effective step size stays
            // ~`marchStepSize` regardless of distance from the light, fixing the original wavy/bumpy
            // shadow edges without introducing light-centered ring artifacts.
            // never sample all the way to the fragment itself — see `marchSurfaceBias`
            const marchTargetDist = dist.sub(marchSurfaceBias).max(0);
            const targetFrac = marchTargetDist.div(dist.max(0.0001));
            const effectiveSteps = marchTargetDist.div(marchStepSize).ceil().clamp(1, marchSteps);
            const occupancy = float(0).toVar();

            Loop(marchSteps, ({ i }) => {
              If(float(i).greaterThanEqual(effectiveSteps), () => {
                Break();
              });
              const t = float(i).add(1).div(effectiveSteps).mul(targetFrac);
              const stepX = tracked.x.add(worldXZ.x.sub(tracked.x).mul(t));
              const stepZ = tracked.y.add(worldXZ.y.sub(tracked.y).mul(t));
              occupancy.assign(occupancy.max(sampleOccupancy(stepX, stepZ)));
              If(occupancy.greaterThanEqual(0.5), () => {
                occupancy.assign(1);
                Break();
              });
            });

            reach.assign(litVal.mul(float(1).sub(occupancy.clamp(0, 1))));
          });
        });

        return reach;
      })().toVar();

      // an even shape with a crisp edge rather than the raw falloff, eased over one pixel
      return smoothstep(0, fwidth(reachNode).max(0.0001), reachNode);
    },
    nextTileOrigin(x, z, force = false) {
      const tileX = Math.floor(x / lightTileSize);
      const tileZ = Math.floor(z / lightTileSize);
      if (force === false && tileCenter !== null && tileCenter.tileX === tileX && tileCenter.tileZ === tileZ) {
        return null;
      }
      // the window is centred on that tile, so it extends a whole tile past the light on every side
      return { originX: (tileX - 1) * lightTileSize, originZ: (tileZ - 1) * lightTileSize };
    },
    beginTile(originX, originZ) {
      pendingOrigin = { originX, originZ };
      const scale = wallTexSize / tileWorldSize;
      wallCt.resetTransform();
      wallCt.clearRect(0, 0, wallTexSize, wallTexSize);
      // world metres -> texture px, so callers draw in world space (composing `gm.matrix` on top)
      wallCt.setTransform(scale, 0, 0, scale, -originX * scale, -originZ * scale);
      return wallCt;
    },
    endTile() {
      if (pendingOrigin === null) {
        return;
      }
      const { originX, originZ } = pendingOrigin;
      pendingOrigin = null;

      wallTex.needsUpdate = true; // uploads the canvas as it stands
      // origin and pixels swap together, so no frame samples one against the other
      tileOrigin.value.set(originX, originZ);
      tileCenter = {
        tileX: Math.round(originX / lightTileSize) + 1,
        tileZ: Math.round(originZ / lightTileSize) + 1,
      };
      combinedTex.textureNeedsUpdate = true;
    },
    setDoors(doors) {
      activeDoorCount = Math.min(doors.length, maxActiveDoors);
      for (let i = 0; i < activeDoorCount; i++) {
        const { src, dst, gapAtHighLambda } = doors[i];
        // orient so the passable gap always grows a->b
        const [a, b] = gapAtHighLambda ? [dst, src] : [src, dst];
        doorSegs[i].set(a.x, a.y, b.x, b.y);
      }
      // -1 marks every slot inactive until the next setDoorRatios call
      doorOpenRatioValues.fill(-1);
      lastDoorRatios = new Array(maxActiveDoors).fill(-1);
      this.doorInstanceIds = doors.slice(0, activeDoorCount).map((d) => d.instanceId);
      combinedTex.textureNeedsUpdate = true;
    },
    setDoorRatios(ratios) {
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
    setIntensity(next) {
      this.intensity.value = next;
    },
    setRadius(next) {
      this.radius = next;
      if (tracked.value.z !== 0) {
        this.setTracked({ x: this.displayCenter.x, z: this.displayCenter.z }, next);
      }
    },
    setTracked(center, radius) {
      if (center === null) {
        tracked.value.z = 0;
      } else {
        tracked.value.set(center.x, center.z, 1, radius ?? tracked.value.w);
      }
    },
    update(camera) {
      camera.updateMatrixWorld();
      camProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
      camWorldMatrix.value.copy(camera.matrixWorld);
      camPosition.value.copy(camera.position);
      const perspectiveCam = camera as THREE.PerspectiveCamera;
      camNear.value = perspectiveCam.near;
      camFar.value = perspectiveCam.far;
    },
  };
}
