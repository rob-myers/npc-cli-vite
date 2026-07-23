import {
  Break,
  Fn,
  float,
  getViewPosition,
  If,
  int,
  Loop,
  logarithmicDepthToViewZ,
  screenUV,
  uniform,
  uniformArray,
  vec2,
  vec4,
  viewZToPerspectiveDepth,
} from "three/tsl";
import * as THREE from "three/webgpu";

export type TrackedLightPostprocessOpts = {
  /** World-space height (y) the light applies from. Default `0` */
  bottomHeight?: number;
  /** World-space height (y) the light applies up to */
  topHeight: number;
  /** World-space distance over which the light fades out, starting at its own radius. Default `0.6` */
  falloff?: number;
};

export type TrackedLightPostprocess = {
  /** Feed the real scene camera (not the internal post-processing quad camera) */
  update(camera: THREE.Camera): void;

  /**
   * Positions the light — e.g. follows a live reference like `npc.position`. Pass `null` to
   * deactivate (center/radius left as last known, harmless while inactive). Omitting `radius`
   * while re-centering keeps the last radius set.
   */
  setTracked(center: { x: number; z: number } | null, radius?: number): void;
  /** Clips the light to this world-space room polygon (or removes clipping if omitted/empty) */
  setTrackedRoomOutline(roomOutline?: { x: number; z: number }[]): void;
  /**
   * World-space segments of the doors bordering the light's current room — a fragment outside
   * the room polygon can still be lit if the straight line from it to the light crosses one of
   * these (see `setDoorOpenRatios`). Capped at `maxTrackedDoors`; call once per room-enter.
   */
  setTrackedRoomDoors(
    doors: {
      a: { x: number; z: number };
      b: { x: number; z: number };
      /** World-space outline of the room on the OTHER side of this door — a fragment is only lit
       * through this door if it's actually inside this polygon, not merely along the line-of-sight
       * (otherwise light can appear to shine through unrelated walls). Capped at `maxAdjRoomPolyVerts`. */
      adjRoomOutline: { x: number; z: number }[];
    }[],
  ): void;
  /**
   * Live 0..1 openness for each door slot set via `setTrackedRoomDoors` (same order/length,
   * truncated/zero-filled to match) — call every frame, mirroring a door's continuously-animated
   * open ratio (e.g. `Doors.tsx`'s `openRatioArray`).
   */
  setDoorOpenRatios(ratios: number[]): void;

  /**
   * `1` inside the light, fading to `0` over `falloff`; `0` if inactive, too far away, or (once
   * outside the room-poly clip) not reachable through an open door — tests each fragment's
   * reconstructed real world position (see impl. for why).
   * @param sceneDepth The scene's depth texture (e.g. `scenePass.getTextureNode("depth")`) — raw
   * logarithmic depth, NOT pre-linearized; this function does its own log-depth inversion.
   */
  litAmount(sceneDepth: THREE.Node<"float">): THREE.Node<"float">;
};

/** Cap on room-polygon vertices for clipping — matches Debug.tsx's MAX_ROOM_POLY_VERTS */
const maxRoomPolyVerts = 64;
/** Cap on doors considered for the "lit through an open door" test, per tracked room */
const maxTrackedDoors = 12; // 🚧 unfinished 101 attains this bound
/**
 * Cap on vertices of each candidate door's adjacent-room polygon — matches `maxRoomPolyVerts`
 * (same kind of data, a processed room outline via `geomService.createOutset`, which unions in a
 * quad per original edge and routinely produces well more than a couple dozen vertices). A
 * smaller cap here previously silently truncated real outlines, and since the vertex loop treats
 * its list as a closed ring, that truncation fabricated a bogus closing edge that could slice a
 * wedge-shaped chunk out of the room — unrelated to any door's position.
 */
const maxAdjRoomPolyVerts = 64;
/**
 * Half-depth (meters) of the rectangle used by `nearDoorRect` to test "is the light inside this
 * door's own physical depth". Matches the larger (hull) of the two real half-depths baked into
 * door geometry (`connectorEntranceHalfDepth` in const.ts: hull 0.5, non-hull 0.375) — non-hull
 * doors end up covered a little more generously than their real depth, an accepted small margin.
 */
const doorHalfDepth = 0.5;

/**
 * Post-processing helper for a single vertical cylinder (axis along y, from `bottomHeight` to
 * `topHeight`) that follows a live target — e.g. `w.npc.trackNpc`. Independent of, and layered
 * alongside, the room-dimmer system (`room-dimmer-postprocess.ts`): the dimmer decides whether a
 * room is dark, this decides whether a fragment is inside the tracked light's reach regardless.
 *
 * `litAmount()` reconstructs each fragment's REAL world position from the scene's depth buffer
 * and tests the light against that, not a plane-projected approximation — otherwise anything
 * screen-aligned with the light but at a different depth (e.g. an npc behind it) would be lit
 * incorrectly. A fragment inside the light's own room (`roomClipFactor`) is lit directly; one
 * outside it can still be reached through an open door — tested as a straight line crossing that
 * door's segment, weighted by its live open ratio (see `setTrackedRoomDoors`/`setDoorOpenRatios`)
 * — rather than baking a neighbouring room's shape into the clip polygon.
 */
export function createTrackedLightPostprocess(opts: TrackedLightPostprocessOpts): TrackedLightPostprocess {
  const falloff = opts.falloff ?? 0.6;
  const bottomHeight = opts.bottomHeight ?? 0;
  const topHeight = opts.topHeight;

  const camProjectionMatrixInverse = uniform(new THREE.Matrix4());
  const camWorldMatrix = uniform(new THREE.Matrix4());
  const camPosition = uniform(new THREE.Vector3());
  // needed to invert the real scene's logarithmic depth back into a world position (see litAmount)
  const camNear = uniform(0.1);
  const camFar = uniform(1000);

  // vec4(worldX, worldZ, activeFlag, radius)
  const tracked = uniform(new THREE.Vector4(0, 0, 0, 1));
  // room-polygon clip — single polygon, no per-slot indexing needed (only ever one tracked light)
  const roomPolyCount = uniform(0);
  const roomPolyVerts = Array.from({ length: maxRoomPolyVerts }, () => new THREE.Vector2());
  const roomPolyVertsNode = uniformArray<"vec2">(roomPolyVerts, "vec2");

  // ray-cast point-in-polygon. 1 = inside room, or unclipped (count == 0); 0 = outside.
  function roomClipFactor(px: THREE.Node<"float">, pz: THREE.Node<"float">) {
    const count = roomPolyCount.toInt();
    const inside = int(0).toVar();

    If(count.greaterThan(0), () => {
      Loop(maxRoomPolyVerts, ({ i: v }) => {
        If(v.greaterThanEqual(count), () => {
          Break();
        });
        const a = roomPolyVertsNode.element(v);
        const b = roomPolyVertsNode.element(v.add(1).mod(count));
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

  // does the straight segment (px,pz)-(lx,lz) cross ANY edge of the current room's polygon? Used
  // to require actual line-of-sight within the room, not just "inside the polygon" — a fragment
  // can test as inside a non-convex room (e.g. L-shaped) while sitting around a wall corner the
  // light can't actually see past; `roomClipFactor` alone can't distinguish that from a genuinely
  // visible fragment, since both are equally "inside". Mirrors the door-crossing test's use of
  // `segmentsCross`, just against every edge of the room's own outline instead of a single door.
  function crossesRoomBoundary(
    px: THREE.Node<"float">,
    pz: THREE.Node<"float">,
    lx: THREE.Node<"float">,
    lz: THREE.Node<"float">,
  ) {
    const count = roomPolyCount.toInt();
    const blocked = int(0).toVar();

    If(count.greaterThan(0), () => {
      Loop(maxRoomPolyVerts, ({ i: v }) => {
        If(v.greaterThanEqual(count), () => {
          Break();
        });
        const a = roomPolyVertsNode.element(v);
        const b = roomPolyVertsNode.element(v.add(1).mod(count));
        If(segmentsCross(px, pz, lx, lz, a.x, a.y, b.x, b.y), () => {
          blocked.assign(int(1));
        });
      });
    });

    return blocked.toFloat();
  }

  // doors bordering the light's current room: vec4(ax, az, bx, bz) per slot, plus each slot's
  // live openness (0 = closed, 1 = fully open) — a fragment outside the room polygon can still be
  // lit if the segment from it to the light crosses one of these, weighted by that door's ratio.
  const doorCount = uniform(0);
  const doorSegs = Array.from({ length: maxTrackedDoors }, () => new THREE.Vector4());
  const doorSegsNode = uniformArray<"vec4">(doorSegs, "vec4");
  const doorOpenRatioValues = new Array<number>(maxTrackedDoors).fill(0);
  const doorOpenRatio = uniformArray<"float">(doorOpenRatioValues, "float");

  // per-door adjacent-room polygon (fixed-size block of `maxAdjRoomPolyVerts` per slot) — required
  // IN ADDITION to the segment crossing test, else a fragment could be lit through a door whose
  // line-of-sight it merely happens to cross, even if it's actually behind some unrelated wall
  // (i.e. "light through walls")
  const doorAdjRoomPolyCount = Array.from({ length: maxTrackedDoors }, () => 0);
  const doorAdjRoomPolyCountNode = uniformArray<"float">(doorAdjRoomPolyCount, "float");
  const doorAdjRoomPolyVerts = Array.from({ length: maxTrackedDoors * maxAdjRoomPolyVerts }, () => new THREE.Vector2());
  const doorAdjRoomPolyVertsNode = uniformArray<"vec2">(doorAdjRoomPolyVerts, "vec2");

  // ray-cast point-in-polygon for door slot `slot` (a plain JS number — always used inside an
  // unrolled `for`, never a dynamic index) — 1 = inside that door's adjacent room, or unclipped
  // (count == 0); 0 = outside. Mirrors `roomClipFactor`, parameterized by a fixed vertex offset.
  function adjRoomClipFactor(slot: number, px: THREE.Node<"float">, pz: THREE.Node<"float">) {
    const count = doorAdjRoomPolyCountNode.element(int(slot)).toInt();
    const base = int(slot * maxAdjRoomPolyVerts);
    const inside = int(0).toVar();

    If(count.greaterThan(0), () => {
      Loop(maxAdjRoomPolyVerts, ({ i: v }) => {
        If(v.greaterThanEqual(count), () => {
          Break();
        });
        const a = doorAdjRoomPolyVertsNode.element(base.add(v));
        const b = doorAdjRoomPolyVertsNode.element(base.add(v.add(1).mod(count)));
        const yCross = a.y.greaterThan(pz).toFloat().notEqual(b.y.greaterThan(pz).toFloat());
        const t = b.x.sub(a.x).mul(pz.sub(a.y)).div(b.y.sub(a.y)).add(a.x);
        If(yCross.and(px.lessThan(t)), () => {
          inside.assign(inside.bitXor(int(1)));
        });
      });
    });

    return count.equal(0).select(float(1), inside.toFloat());
  }

  // do segments (px,pz)-(qx,qz) and (ax,az)-(bx,bz) cross? standard parametric t/u in [0,1] test.
  function segmentsCross(
    px: THREE.Node<"float">,
    pz: THREE.Node<"float">,
    qx: THREE.Node<"float">,
    qz: THREE.Node<"float">,
    ax: THREE.Node<"float">,
    az: THREE.Node<"float">,
    bx: THREE.Node<"float">,
    bz: THREE.Node<"float">,
  ) {
    const d1x = qx.sub(px);
    const d1z = qz.sub(pz);
    const d2x = bx.sub(ax);
    const d2z = bz.sub(az);
    const denom = d1x.mul(d2z).sub(d1z.mul(d2x));
    const dx = ax.sub(px);
    const dz = az.sub(pz);
    const t = dx.mul(d2z).sub(dz.mul(d2x)).div(denom);
    const u = dx.mul(d1z).sub(dz.mul(d1x)).div(denom);
    // 🔔 denom==0 (parallel) makes t/u ±Infinity/NaN, which naturally fails the clamp checks below
    return t.greaterThanEqual(0).and(t.lessThanEqual(1)).and(u.greaterThanEqual(0)).and(u.lessThanEqual(1));
  }

  // is (px,pz) inside the door's own rectangle — within `doorHalfDepth` of the door LINE
  // (perpendicular component) AND within its WIDTH span (parallel component, UNCLAMPED: a point
  // past either end doesn't count, even if physically close to a doorframe post — that's an
  // adjacent wall, not the doorway).
  function nearDoorRect(
    px: THREE.Node<"float">,
    pz: THREE.Node<"float">,
    ax: THREE.Node<"float">,
    az: THREE.Node<"float">,
    bx: THREE.Node<"float">,
    bz: THREE.Node<"float">,
  ) {
    const abx = bx.sub(ax);
    const abz = bz.sub(az);
    const lenSq = abx.mul(abx).add(abz.mul(abz));
    const dpx = px.sub(ax);
    const dpz = pz.sub(az);
    const t = dpx.mul(abx).add(dpz.mul(abz)).div(lenSq);
    const cross = abx.mul(dpz).sub(abz.mul(dpx));
    const perpDist = cross.abs().div(lenSq.sqrt());
    return t.greaterThanEqual(0).and(t.lessThanEqual(1)).and(perpDist.lessThan(doorHalfDepth));
  }

  // nearest point on segment (ax,az)-(bx,bz) to (px,pz), clamped to its extent
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
    setTrackedRoomOutline(roomOutline) {
      const count = roomOutline ? Math.min(roomOutline.length, maxRoomPolyVerts) : 0;
      roomPolyCount.value = count;
      if (roomOutline) {
        for (let v = 0; v < count; v++) {
          roomPolyVerts[v].set(roomOutline[v].x, roomOutline[v].z);
        }
      }
    },
    setTrackedRoomDoors(doors) {
      const count = Math.min(doors.length, maxTrackedDoors);
      doorCount.value = count;
      for (let i = 0; i < count; i++) {
        doorSegs[i].set(doors[i].a.x, doors[i].a.z, doors[i].b.x, doors[i].b.z);
        const adjOutline = doors[i].adjRoomOutline;
        const adjCount = Math.min(adjOutline.length, maxAdjRoomPolyVerts);
        doorAdjRoomPolyCount[i] = adjCount;
        const base = i * maxAdjRoomPolyVerts;
        for (let v = 0; v < adjCount; v++) {
          doorAdjRoomPolyVerts[base + v].set(adjOutline[v].x, adjOutline[v].z);
        }
      }
      // zero-fill unused slots so `setDoorOpenRatios` (called separately, every frame) can't
      // accidentally leave stale data from a previous, larger room's door list
      for (let i = count; i < maxTrackedDoors; i++) {
        doorSegs[i].set(0, 0, 0, 0);
        doorAdjRoomPolyCount[i] = 0;
      }
    },
    setDoorOpenRatios(ratios) {
      const count = Math.min(ratios.length, maxTrackedDoors);
      for (let i = 0; i < count; i++) {
        doorOpenRatioValues[i] = ratios[i];
      }
      for (let i = count; i < maxTrackedDoors; i++) {
        doorOpenRatioValues[i] = 0;
      }
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
          // distance first, cheaply — skips the room-polygon loop AND the door-segment checks
          // below entirely for the vast majority of fragments (anything out of the light's
          // reach), and since this is a real `If` (warp-coherent), whole neighbouring fragments
          // that are uniformly far away skip the rest of the branch together
          const dist = worldXZ.sub(tracked.xy).length();
          const litVal = float(1).sub(dist.sub(tracked.w).div(falloff).clamp(0, 1));

          If(litVal.greaterThan(0), () => {
            const inRoom = roomClipFactor(worldXZ.x, worldXZ.y);
            const reached = float(0).toVar();

            // being inside the room polygon isn't enough on its own — a non-convex room (e.g.
            // L-shaped) can have a fragment test as "inside" while sitting around a wall corner
            // the light can't actually see past. Require an unobstructed straight line to the
            // light too (same segment-crossing test used for doors, just against the room's own
            // boundary edges), so the lit area actually follows the room's true shape.
            If(inRoom.greaterThan(0), () => {
              const blocked = crossesRoomBoundary(worldXZ.x, worldXZ.y, tracked.x, tracked.y);
              reached.assign(blocked.equal(0).select(float(1), float(0)));
            });

            // no direct line of sight within the room (whether outside the polygon entirely, or
            // blocked by a wall corner): still lit if a straight line to the light crosses one of
            // the room's own doors AND the fragment is actually inside that door's adjacent room
            // (not merely along the line-of-sight — otherwise light can appear to shine through
            // an unrelated wall), weighted by that door's live openness (0 = closed).
            //
            // 🔔 the crossing test needs the light's position on the CORRECT side of the door —
            // but the light can walk past that dividing line slightly before the (event-driven,
            // collider-based) room/door data catches up. Rather than using the light's true
            // position in that narrow window (which would make the crossing test fail outright —
            // a genuine discontinuity, not just numerical noise), clamp it onto the door's own
            // line whenever it's inside that door's physical depth AND has already left the
            // current room polygon. That's the continuous limit of the correct crossing result
            // (verified by hand: `t` in the crossing test tends to exactly this as the light
            // approaches the line from the current-room side), so it recovers a smooth "the light
            // is basically at the doorway" reach instead of losing it — without ever granting
            // unconditional full-room access the way a plain distance threshold would.
            const npcInRoom = roomClipFactor(tracked.x, tracked.y).greaterThan(0);
            If(reached.equal(0), () => {
              for (let slot = 0; slot < maxTrackedDoors; slot++) {
                If(int(slot).lessThan(doorCount.toInt()), () => {
                  const seg = doorSegsNode.element(int(slot));
                  const useClamped = npcInRoom
                    .not()
                    .and(nearDoorRect(tracked.x, tracked.y, seg.x, seg.y, seg.z, seg.w));
                  const clamped = nearestPointOnSegment(tracked.x, tracked.y, seg.x, seg.y, seg.z, seg.w);
                  const npcX = useClamped.select(clamped.x, tracked.x);
                  const npcZ = useClamped.select(clamped.z, tracked.y);
                  const crosses = segmentsCross(worldXZ.x, worldXZ.y, npcX, npcZ, seg.x, seg.y, seg.z, seg.w);
                  If(crosses, () => {
                    const inAdjRoom = adjRoomClipFactor(slot, worldXZ.x, worldXZ.y);
                    If(inAdjRoom.greaterThan(0), () => {
                      reached.assign(reached.max(doorOpenRatio.element(int(slot))));
                    });
                  });
                });
              }
            });

            litOut.assign(litVal.mul(reached));
          });
        });

        return litOut;
      })();
    },
  };
}
