import { geomorphKeys } from "@npc-cli/media/starship-symbol";
import {
  Fn,
  float,
  getViewPosition,
  If,
  int,
  logarithmicDepthToViewZ,
  screenUV,
  texture,
  uniform,
  uniformArray,
  vec2,
  vec4,
  viewZToPerspectiveDepth,
} from "three/tsl";
import * as THREE from "three/webgpu";
import {
  floorTextureDimension,
  gmIdGridDim,
  MAX_GEOMORPH_INSTANCES,
  maxRoomsPerGm,
  roomHitTextureScaleDown,
} from "../const";
import type DerivedGmsData from "./DerivedGmsData";
import { createGmIdGridTexture } from "./grid";
import { worldToCanvas } from "./texture";

export type RoomDimmerPostprocessOpts = {
  /** World-space height (y) dimming applies from. Default `0` */
  bottomHeight?: number;
  /** World-space height (y) dimming applies up to */
  topHeight: number;
  /** Is the dimming effect active at all? Default `true`. Toggle later via `setDimmingEnabled`. */
  dimmingEnabled?: boolean;
};

export type RoomDimmerPostprocess = {
  /** `0` or `1`. When `0`, `dimAmount()` always returns `0` (nothing dimmed). Toggle via `setDimmingEnabled`. */
  dimmingEnabled: THREE.UniformNode<"float", number>;
  setDimmingEnabled(enabled: boolean): void;
  /** Feed the real scene camera (not the internal post-processing quad camera) */
  update(camera: THREE.Camera): void;

  /**
   * Rebuilds every piece of per-instance/per-layout GPU state from the current gm instances: the
   * world-space "which gm instance is here" grid texture, each instance's inverse transform, and
   * (lazily, once per unique gmKey) uploads that layout's baked room-mask texture layer. Also
   * clears all dimmed rooms (a new set of instances means old room indices are meaningless).
   */
  syncGms(gms: Geomorph.LayoutInstance[], gmsData: DerivedGmsData): void;
  setRoomDimmed(gmId: number, roomId: number, dimmed: boolean): void;
  isRoomDimmed(gmId: number, roomId: number): boolean;
  /** Clears every dimmed room in one pass */
  resetAllRooms(): void;

  /**
   * `1` inside a dimmed room, `0` elsewhere (hard binary, no fade) — two texture samples (which gm
   * instance, then which room within it) plus a boolean lookup, independent of how many rooms are
   * currently dimmed.
   * @param sceneDepth The scene's depth texture (e.g. `scenePass.getTextureNode("depth")`) — raw
   * logarithmic depth, NOT pre-linearized; this function does its own log-depth inversion.
   */
  dimAmount(sceneDepth: THREE.Node<"float">): THREE.Node<"float">;
};

/** Resolution (px) of the baked per-gmKey room-mask texture — matches `DerivedGmsData`'s `roomHitCt` */
const roomMaskDim = Math.round(floorTextureDimension * roomHitTextureScaleDown);

/**
 * Post-processing helper for dimming whole rooms. A room is either dimmed or not (no radius, no
 * growth) — so instead of per-fragment polygon ray-casting against baked light shapes, this
 * samples two small baked textures:
 *
 * 1. `texGmId` — one texel per `gmIdGridDim`-sized world cell (mirrors `service/grid.ts`'s
 *    `createGmIdGrid`/`queryGmIdGrid`, baked as a texture instead of a sparse JS object), giving
 *    "which gm instance is here" in O(1), nearest-filtered.
 * 2. `texRoomMask` — one layer per unique geomorph layout (not per instance — shared across every
 *    instance of that layout), R = `roomId + 1` (see `DerivedGmsData.computeGmKey`), nearest-filtered
 *    (hard binary dimming — no fade, so no need for bilinear blending between adjacent room ids).
 *
 * `dimAmount()` reconstructs each fragment's REAL world position from the scene's depth buffer
 * (as before — this part is unchanged and still the most expensive part of the function, see
 * CONVERSATIONS.md "Lighting Performance"), then does those two texture samples plus a direct
 * `roomDimmed` boolean-array lookup — no loop over rooms, lights, or gm instances at all.
 */
export function createRoomDimmerPostprocess(opts: RoomDimmerPostprocessOpts): RoomDimmerPostprocess {
  const bottomHeight = opts.bottomHeight ?? 0;
  const topHeight = opts.topHeight;

  const camProjectionMatrixInverse = uniform(new THREE.Matrix4());
  const camWorldMatrix = uniform(new THREE.Matrix4());
  const camPosition = uniform(new THREE.Vector3());
  // needed to invert the real scene's logarithmic depth back into a world position (see dimAmount)
  const camNear = uniform(0.1);
  const camFar = uniform(1000);
  const dimmingEnabled = uniform((opts.dimmingEnabled ?? true) ? 1 : 0);

  // "which gm instance is here" — one texel per gmIdGridDim-sized cell, R = gmId + 1 (0 = none).
  // 🔔 fixed-size buffer, never resized after creation — swapping `.image` for a differently-sized
  // one does NOT reallocate the underlying GPU texture (causes a "touches outside of texture"
  // WriteTexture error), so instead we always write into a subregion of one generously-sized
  // (64x64 cells, ~960m per side at gmIdGridDim=15m) fixed buffer, same idiom as `texRoomMask`.
  const gmGridMaxDim = 64;
  const gmGridOrigin = uniform(new THREE.Vector2(0, 0));
  const texGmIdData = new Uint8Array(gmGridMaxDim * gmGridMaxDim * 4);
  const texGmId = new THREE.DataTexture(texGmIdData, gmGridMaxDim, gmGridMaxDim, THREE.RGBAFormat);
  texGmId.magFilter = THREE.NearestFilter;
  texGmId.minFilter = THREE.NearestFilter;
  texGmId.needsUpdate = true;

  // one room-mask layer per unique layout (gmKey), not per instance. Nearest-filtered: R encodes
  // a room id, so bilinear blending at room-boundary texels would produce a bogus in-between id.
  const texRoomMaskData = new Uint8Array(roomMaskDim * roomMaskDim * 4 * geomorphKeys.length);
  const texRoomMask = new THREE.DataArrayTexture(texRoomMaskData, roomMaskDim, roomMaskDim, geomorphKeys.length);
  texRoomMask.magFilter = THREE.NearestFilter;
  texRoomMask.minFilter = THREE.NearestFilter;
  const gmKeyToLayoutIndex = new Map<string, number>();

  // per-instance state, mirrored in plain JS (same idiom as Walls.tsx's light0Values/light1Values)
  const gmInv1Values = Array.from({ length: MAX_GEOMORPH_INSTANCES }, () => new THREE.Vector4(1, 0, 0, 1));
  const gmInv2Values = Array.from({ length: MAX_GEOMORPH_INSTANCES }, () => new THREE.Vector4(0, 0, 0, 0));
  const gmLayoutIdxValues = new Array<number>(MAX_GEOMORPH_INSTANCES).fill(0);
  const gmInv1 = uniformArray<"vec4">(gmInv1Values, "vec4");
  const gmInv2 = uniformArray<"vec4">(gmInv2Values, "vec4");
  const gmLayoutIdx = uniformArray<"float">(gmLayoutIdxValues, "float");

  const roomDimmedValues = new Array<number>(MAX_GEOMORPH_INSTANCES * maxRoomsPerGm).fill(0);
  const roomDimmed = uniformArray<"float">(roomDimmedValues, "float");

  function rayXZAt(planeHeight: number) {
    // reconstruct the view ray direction (only direction matters, so depth value is arbitrary)
    const viewDirPoint = getViewPosition(screenUV, float(0.5), camProjectionMatrixInverse);
    const worldDir = camWorldMatrix.mul(vec4(viewDirPoint, 0.0)).xyz.normalize();
    // intersect with y=planeHeight: camPosition.y + t * worldDir.y = planeHeight
    const t = float(planeHeight).sub(camPosition.y).div(worldDir.y);
    return camPosition.add(worldDir.mul(t)).xz;
  }

  /** Given a fragment's world XZ, returns `1` if its room is dimmed, else `0` (hard binary, no fade) */
  function sampleRoomDim(worldXZ: THREE.Node<"vec2">): THREE.Node<"float"> {
    const cellX = worldXZ.x.div(gmIdGridDim).floor().sub(gmGridOrigin.x);
    const cellY = worldXZ.y.div(gmIdGridDim).floor().sub(gmGridOrigin.y);
    const gridUv = vec2(cellX.add(0.5).div(gmGridMaxDim), cellY.add(0.5).div(gmGridMaxDim));
    const gmId = texture(texGmId, gridUv).r.mul(255).round().sub(1).toInt();

    const dimmedOut = float(0).toVar();

    If(gmId.greaterThanEqual(0), () => {
      const inv1 = gmInv1.element(gmId); // (a, b, c, d)
      const inv2 = gmInv2.element(gmId); // (e, f, bounds.x, bounds.y)
      const layoutIdx = gmLayoutIdx.element(gmId).toInt();

      // world -> this instance's local (layout) space, matching Mat's x'=a*x+c*y+e, y'=b*x+d*y+f
      const localX = inv1.x.mul(worldXZ.x).add(inv1.z.mul(worldXZ.y)).add(inv2.x);
      const localY = inv1.y.mul(worldXZ.x).add(inv1.w.mul(worldXZ.y)).add(inv2.y);

      // local -> room-mask uv, mirroring DerivedGmsData's roomHitCt/dimMaskCt transform.
      // 🔔 divide by `floorTextureDimension`, NOT `roomMaskDim` — canvasPixel = (local-bounds) *
      // (roomHitTextureScaleDown * worldToCanvas), canvasSize = floorTextureDimension *
      // roomHitTextureScaleDown, so uv = canvasPixel/canvasSize = (local-bounds) * worldToCanvas
      // / floorTextureDimension once `roomHitTextureScaleDown` cancels — dividing by `roomMaskDim`
      // instead skipped that cancellation and left an extra factor of `gmFloorExtraScale`.
      const roomUv = vec2(
        localX.sub(inv2.z).mul(worldToCanvas).div(floorTextureDimension),
        localY.sub(inv2.w).mul(worldToCanvas).div(floorTextureDimension),
      );

      const roomSample = texture(texRoomMask, roomUv).depth(layoutIdx);
      const roomId = roomSample.r.mul(255).round().sub(1).toInt();

      If(roomId.greaterThanEqual(0), () => {
        const dimIdx = gmId.mul(int(maxRoomsPerGm)).add(roomId);
        dimmedOut.assign(roomDimmed.element(dimIdx));
      });
    });

    return dimmedOut;
  }

  function uploadRoomMaskLayer(layoutIndex: number, ct: CanvasRenderingContext2D) {
    const { data } = ct.getImageData(0, 0, roomMaskDim, roomMaskDim);
    texRoomMaskData.set(data, layoutIndex * roomMaskDim * roomMaskDim * 4);
    texRoomMask.needsUpdate = true;
  }

  return {
    dimmingEnabled,
    setDimmingEnabled(isEnabled) {
      dimmingEnabled.value = isEnabled ? 1 : 0;
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
    syncGms(gms, gmsData) {
      const grid = createGmIdGridTexture(gms);
      texGmIdData.fill(0);
      const copyW = Math.min(grid.width, gmGridMaxDim);
      const copyH = Math.min(grid.height, gmGridMaxDim);
      if (grid.width > gmGridMaxDim || grid.height > gmGridMaxDim) {
        console.warn(
          `room-dimmer: gm-id grid (${grid.width}x${grid.height}) exceeds max ${gmGridMaxDim}x${gmGridMaxDim} — clamped`,
        );
      }
      for (let y = 0; y < copyH; y++) {
        const src = grid.data.subarray(y * grid.width * 4, y * grid.width * 4 + copyW * 4);
        texGmIdData.set(src, y * gmGridMaxDim * 4);
      }
      texGmId.needsUpdate = true;
      gmGridOrigin.value.set(grid.originX, grid.originY);

      for (let i = 0; i < MAX_GEOMORPH_INSTANCES; i++) {
        const gm = gms[i];
        if (!gm) {
          gmInv1Values[i].set(1, 0, 0, 1);
          gmInv2Values[i].set(0, 0, 0, 0);
          gmLayoutIdxValues[i] = 0;
          continue;
        }

        const { a, b, c, d, e, f } = gm.inverseMatrix;
        gmInv1Values[i].set(a, b, c, d);
        gmInv2Values[i].set(e, f, gm.bounds.x, gm.bounds.y);

        let layoutIndex = gmKeyToLayoutIndex.get(gm.key);
        if (layoutIndex === undefined) {
          layoutIndex = gmKeyToLayoutIndex.size;
          gmKeyToLayoutIndex.set(gm.key, layoutIndex);
          uploadRoomMaskLayer(layoutIndex, gmsData.byKey[gm.key].dimMaskCt);
        }
        gmLayoutIdxValues[i] = layoutIndex;
      }

      roomDimmedValues.fill(0);
    },
    setRoomDimmed(gmId, roomId, dimmed) {
      roomDimmedValues[gmId * maxRoomsPerGm + roomId] = dimmed ? 1 : 0;
    },
    isRoomDimmed(gmId, roomId) {
      return roomDimmedValues[gmId * maxRoomsPerGm + roomId] === 1;
    },
    resetAllRooms() {
      roomDimmedValues.fill(0);
    },
    dimAmount(sceneDepth) {
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
          // fixes dimming an npc that's actually in front of/behind the room's floor but
          // screen-aligned with it, which a plane-only test can't distinguish
          const ndcDepth = viewZToPerspectiveDepth(viewZ, camNear, camFar);
          const viewPos = getViewPosition(screenUV, ndcDepth, camProjectionMatrixInverse);
          const realWorldPos = camWorldMatrix.mul(vec4(viewPos, 1.0)).xyz;
          worldXZ.assign(realWorldPos.xz);
          worldY.assign(realWorldPos.y);
        });

        const inHeightRange = worldY.greaterThanEqual(float(bottomHeight)).and(worldY.lessThanEqual(float(topHeight)));

        const result = float(0).toVar();
        If(inHeightRange, () => {
          result.assign(sampleRoomDim(worldXZ));
        });

        // when dimming is disabled, pretend no room is ever dimmed
        return dimmingEnabled.equal(0).select(float(0), result);
      })();
    },
  };
}
