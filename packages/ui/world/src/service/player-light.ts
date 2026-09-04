import { Mat, Vect } from "@npc-cli/util/geom";
import {
  abs,
  atan,
  attributeArray,
  Break,
  Continue,
  cos,
  Fn,
  float,
  If,
  instanceIndex,
  int,
  Loop,
  mix,
  positionWorld,
  sin,
  smoothstep,
  uniform,
  vec2,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { MAX_DOORS } from "../const";
import type DerivedGmsData from "./DerivedGmsData";

/**
 * The player's light polygon: what can be seen from where they stand, bounded by the walls and by
 * the closed part of each possibly-partially open door.
 *
 * Rather than asking that question per fragment, a compute pass answers it once per frame for
 * `lightAngles` directions, writing the distance to the nearest occluder into a polar table.
 * Any material then reads an entry of that table to know whether it is lit.
 *
 * The table is built once and never rebuilt, so the materials reading it survive a map change —
 * only the occluder buffers (which only the sweep looks at) are refilled.
 */
export function createPlayerLight(): PlayerLight {
  /** Where the light stands in world XZ */
  const origin = uniform(new THREE.Vector2());
  /**
   * How black an unseen fragment goes: `unlitTint` whilst there is a player, `0` otherwise. The two
   * are folded into one uniform, so every material is exactly identity with the light off and none
   * of them multiplies a constant by a uniform per fragment
   */
  const unlitAmount = uniform(0);

  /** Look direction in world XZ — the light falling outside this cone is dimmed a bit */
  const facing = uniform(new THREE.Vector2(1, 0));

  // The occluders. Fixed capacity, so the compute node never has to be rebuilt — the counts say
  // how much of each is real, and the loops stop there.
  // Every wall in the world, kept on the CPU: the sweep only ever sees the ones within reach
  let sourceWalls = new Float32Array(0);
  let sourceCount = 0;
  const wallValues = new Float32Array(maxLightSegs * 4);
  const wallSegs = attributeArray(wallValues, "vec4");
  const wallCount = uniform(0);
  /** Where the light stood when that subset was last chosen, and whether it must be chosen again */
  const culledAt = { x: Number.NaN, z: Number.NaN };
  let cullDirty = true;
  /** Whether the table has ever been written — until it has, an unchanged frame still needs one */
  let swept = false;

  // a door is a fixed line with a moving gap, so only its open ratio changes per frame
  const doorValues = new Float32Array(MAX_DOORS * 4);
  const doorSegs = attributeArray(doorValues, "vec4");
  /** Per door: `1` when its gap opens towards `dst`, else `0` — see `Doors`' `gapAtHighLambda` */
  const doorGapValues = new Float32Array(MAX_DOORS);
  const doorGaps = attributeArray(doorGapValues, "float");
  const doorOpenValues = new Float32Array(MAX_DOORS);
  const doorOpen = attributeArray(doorOpenValues, "float");
  const doorCount = uniform(0);

  /** Distance to the nearest occluder, per angle — what the sweep writes and materials read */
  const table = attributeArray(new Float32Array(lightAngles), "float");

  /**
   * Nearest hit along `dir` from the light, over one segment `(a, b)`. Standard 2D ray-segment
   * intersection: the ray reaches `t` along itself and `u` along the segment, and the hit counts
   * whilst `u` lies within it. A near-parallel segment divides by nearly nothing, so the guard is
   * on `denom` rather than on the results
   */
  const hitSegment = Fn(
    ([dirX, dirY, ax, ay, bx, by, nearest]: [
      THREE.Node<"float">,
      THREE.Node<"float">,
      THREE.Node<"float">,
      THREE.Node<"float">,
      THREE.Node<"float">,
      THREE.Node<"float">,
      THREE.Node<"float">,
    ]) => {
      const ex = bx.sub(ax);
      const ey = by.sub(ay);
      const denom = dirX.mul(ey).sub(dirY.mul(ex));
      const safe = abs(denom).lessThan(parallelUntil).select(float(1), denom);
      const ox = ax.sub(origin.x);
      const oy = ay.sub(origin.y);
      const t = ox.mul(ey).sub(oy.mul(ex)).div(safe);
      const u = ox.mul(dirY).sub(oy.mul(dirX)).div(safe);

      const closer = abs(denom)
        .greaterThanEqual(parallelUntil)
        .and(t.greaterThan(0))
        .and(t.lessThan(nearest))
        .and(u.greaterThanEqual(0))
        .and(u.lessThanEqual(1));
      return closer.select(t, nearest);
    },
  );

  const sweep = Fn(() => {
    const angle = float(instanceIndex).mul((2 * Math.PI) / lightAngles);
    const dirX = cos(angle);
    const dirY = sin(angle);
    const nearest = float(lightRadius).toVar();

    Loop(maxLightSegs, ({ i }: { i: THREE.Node<"int"> }) => {
      If(i.toFloat().greaterThanEqual(wallCount), () => {
        Break();
      });
      const seg = wallSegs.element(i);
      // Cheap reject before the intersection: a segment whose midpoint is further than the light
      // reaches, by more than its own half length, cannot be hit. Six operations against a dozen,
      // and it covers whatever the culling left in that is out of reach from this angle
      const midX = seg.x.add(seg.z).mul(0.5);
      const midY = seg.y.add(seg.w).mul(0.5);
      const halfLen = vec2(seg.z.sub(seg.x), seg.w.sub(seg.y)).length().mul(0.5);
      const toMid = vec2(midX.sub(origin.x), midY.sub(origin.y)).length();
      If(toMid.sub(halfLen).lessThanEqual(lightRadius), () => {
        nearest.assign(hitSegment(dirX, dirY, seg.x, seg.y, seg.z, seg.w, nearest));
      });
    });

    Loop(MAX_DOORS, ({ i }: { i: THREE.Node<"int"> }) => {
      If(i.toFloat().greaterThanEqual(doorCount), () => {
        Break();
      });
      const seg = doorSegs.element(i);
      // the same reject the walls get: a door whose midpoint is out of reach by more than its own
      // half length cannot be hit, and only a handful are ever within reach
      const doorMidX = seg.x.add(seg.z).mul(0.5);
      const doorMidY = seg.y.add(seg.w).mul(0.5);
      const doorHalfLen = vec2(seg.z.sub(seg.x), seg.w.sub(seg.y)).length().mul(0.5);
      const toDoorMid = vec2(doorMidX.sub(origin.x), doorMidY.sub(origin.y)).length();
      If(toDoorMid.sub(doorHalfLen).greaterThan(lightRadius), () => {
        Continue();
      });

      const ratio = doorOpen.element(i);
      // the CLOSED part of the door is what casts a shadow, and it shrinks from whichever end the
      // gap opens at — mirroring the `inGap` test in `Doors`. A fully open door collapses to a
      // point, whose zero-length edge the parallel guard above throws away
      const gapAtHigh = doorGaps.element(i).greaterThan(0.5);
      const lowX = mix(seg.x, seg.z, ratio);
      const lowY = mix(seg.y, seg.w, ratio);
      const highX = mix(seg.x, seg.z, ratio.oneMinus());
      const highY = mix(seg.y, seg.w, ratio.oneMinus());
      const ax = gapAtHigh.select(seg.x, lowX);
      const ay = gapAtHigh.select(seg.y, lowY);
      const bx = gapAtHigh.select(highX, seg.z);
      const by = gapAtHigh.select(highY, seg.w);
      nearest.assign(hitSegment(dirX, dirY, ax, ay, bx, by, nearest));
    });

    table.element(instanceIndex).assign(nearest);
  })().compute(lightAngles);

  /**
   * How lit a world XZ is: `1` where the light reaches it, `0` where it does not, with the penumbra
   * in between. There is no falloff with distance — the polygon simply ends where the sweep's own
   * `lightRadius` cap put it. Taken as an argument rather than read off `positionWorld`, so that
   * anything holding a world position can ask
   */
  function litAt(worldXZ: THREE.Node<"vec2">, outset = 0) {
    const away = worldXZ.sub(origin);
    // asked about a point pulled `outset` nearer, which grows the polygon outwards. Branched in js
    // rather than in the shader, so the usual case emits no subtract at all
    return litFrom(away, outset === 0 ? away.length() : away.length().sub(outset));
  }

  /**
   * The same, for a caller that has already worked out where it stands relative to the light —
   * `applyLight` has, for the cone, and recomputing the pair here cost it a vec2 subtract and a
   * `length` per fragment in every material that lights anything
   */
  function litFrom(away: THREE.Node<"vec2">, dist: THREE.Node<"float">) {
    // The angle, as a position along the table. The sweep writes index `i` for `2π i / N`, so
    // index 0 is angle 0 — and `atan` gives `[-π, π]`, whose negative half must WRAP to the top of
    // the table rather than being shifted into its bottom, which would turn the polygon 180°
    const at = atan(away.y, away.x)
      .mul(1 / (2 * Math.PI))
      .add(1)
      .fract()
      .mul(lightAngles);
    const lower = at.floor();
    const index = int(lower);
    const along = at.sub(lower);
    const near = table.element(index.mod(int(lightAngles)));
    const far = table.element(index.add(1).mod(int(lightAngles)));

    // How far apart two neighbouring angles are HERE — the error the table can be out by, growing
    // with distance, which is why the far end of a room shimmers whilst the near end does not. The
    // boundary is SOFTENED over it rather than tested against: a hard edge can only land on one of
    // the angles the table holds, so it snaps by an arc as the light moves, and no bias hides that
    const width = dist
      .mul((2 * Math.PI) / lightAngles)
      .mul(penumbraArcs)
      .add(lightBias);

    // The two ANSWERS are blended, never the two distances: where the samples straddle a shadow
    // edge they belong to different surfaces and a distance halfway between lies on neither. A
    // surface the light grazes — a door being walked PAST — is that case along its whole length,
    // which is why choosing between the samples there flickered as the angles slid beneath it
    return mix(
      smoothstep(near.sub(width), near.add(width), dist).oneMinus(),
      smoothstep(far.sub(width), far.add(width), dist).oneMinus(),
      along,
    );
  }

  /**
   * How far inside the cone they are looking down this fragment lies, `1` within it and `0` beyond.
   *
   * Softened over `coneSoftDeg` either side rather than cut at the edge: a hard one is a straight
   * line drawn across the floor, and it crawls as they turn
   */
  function coneAt(away: THREE.Node<"vec2">, fromPlayer: THREE.Node<"float">) {
    // The dot BEFORE the divide: `dot(v / d, f)` is `dot(v, f) / d`, and one scalar divide is
    // cheaper than a vec2 one. `max` guards it — at their very feet `d` is nought, and what comes
    // out is a NaN that nothing downstream swallows
    const ahead = away.dot(facing).div(fromPlayer.max(parallelUntil));
    return smoothstep(float(coneOuterCos), float(coneInnerCos), ahead);
  }

  function applyLight(color: THREE.Node<"vec3">) {
    const away = positionWorld.xz.sub(origin);
    const fromPlayer = away.length();
    const cone = coneAt(away, fromPlayer);

    // What is not ahead of them is DIMMED, though not within `coneFrom`: close in a fragment's
    // bearing swings about wildly, and dimming there reads as a shadow they are standing in.
    //
    // Taken off `lit` rather than off the colour, so `unlitTint` is the floor for both: the cone
    // can never go darker than somewhere the light simply does not reach
    const held = smoothstep(float(0), float(coneFrom), fromPlayer);
    const lit = litFrom(away, fromPlayer).mul(float(1).sub(cone.oneMinus().mul(held).mul(coneAmount)));
    // towards black, written as the multiply it is rather than as a `mix` against a colour the
    // compiler would have to carry three zeroes for
    return color.mul(float(1).sub(unlitAmount.mul(lit.oneMinus())));
  }

  /**
   * Copies the walls within reach of `(x, z)` into the buffer the sweep reads, by distance from
   * the segment rather than from its ends, so a long wall running past the light is kept. The
   * margin is what lets the light move `cullRebuildDist` before this has to be done again.
   */
  function cullWalls(x: number, z: number) {
    const reach = lightRadius + cullMargin;
    let count = 0;

    for (let i = 0; i < sourceCount && count < maxLightSegs; i++) {
      const ax = sourceWalls[i * 4 + 0];
      const ay = sourceWalls[i * 4 + 1];
      const bx = sourceWalls[i * 4 + 2];
      const by = sourceWalls[i * 4 + 3];
      const ex = bx - ax;
      const ey = by - ay;
      const lengthSq = ex * ex + ey * ey;
      const along = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * ex + (z - ay) * ey) / lengthSq));
      if (Math.hypot(x - (ax + along * ex), z - (ay + along * ey)) > reach) continue;

      wallValues[count * 4 + 0] = ax;
      wallValues[count * 4 + 1] = ay;
      wallValues[count * 4 + 2] = bx;
      wallValues[count * 4 + 3] = by;
      count++;
    }

    wallCount.value = count;
    wallSegs.value.needsUpdate = true;
    culledAt.x = x;
    culledAt.z = z;
    cullDirty = false;
  }

  return {
    uid: crypto.randomUUID(),

    litAt,
    applyLight,

    applyLightRgba(color) {
      return vec4(applyLight(color.rgb), color.a);
    },

    applyUnlitRgba(color) {
      // the same tint the unseen parts of the world take, so a dark ceiling matches a dark room
      // rather than being its own shade of black — and identity whilst the light is off
      return vec4(color.rgb.mul(unlitAmount.oneMinus()), color.a);
    },

    syncWalls(gms, gmsData) {
      const total = gms.reduce((sum, gm) => sum + gmsData.byKey[gm.key].wallSegs.length, 0);
      if (sourceWalls.length < total * 4) sourceWalls = new Float32Array(total * 4);

      let count = 0;
      const mat = new Mat();
      const u = new Vect();
      const v = new Vect();

      for (const gm of gms) {
        mat.setMatrixValue(gm.transform);
        for (const { seg } of gmsData.byKey[gm.key].wallSegs) {
          // `wallSegs` are in the layout's own space, and every instance of a layout shares them —
          // so they are copied out before being transformed, never transformed in place
          mat.transformPoint(u.copy(seg[0]));
          mat.transformPoint(v.copy(seg[1]));
          sourceWalls[count * 4 + 0] = u.x;
          sourceWalls[count * 4 + 1] = u.y;
          sourceWalls[count * 4 + 2] = v.x;
          sourceWalls[count * 4 + 3] = v.y;
          count++;
        }
      }

      sourceCount = count;
      cullDirty = true;
    },

    update(renderer, at, rotationY, doors, openRatios) {
      // the WebGL fallback runs "compute" through transform feedback, which this sweep's storage
      // buffers are not going to survive — better an unlit world than a broken one
      if ((renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend !== true) {
        unlitAmount.value = 0;
        return;
      }
      if (at === null) {
        unlitAmount.value = 0;
        return;
      }
      unlitAmount.value = unlitTint;

      const moved = Math.hypot(at.x - origin.value.x, at.z - origin.value.y);
      origin.value.set(at.x, at.z);
      // three's rotation-Y back to a direction in world XZ — the inverse of `getThreeRotationY`.
      // A direction rather than an angle, so the test above is a dot rather than another `atan`
      const lookAngle = -rotationY - Math.PI / 2;
      facing.value.set(Math.cos(lookAngle), Math.sin(lookAngle));

      // Only the walls the light could possibly reach are handed to the sweep, which otherwise
      // loops every wall in the world for every angle. Re-chosen when the light has wandered far
      // enough that the margin no longer covers it, rather than every frame
      if (cullDirty === true || Math.hypot(at.x - culledAt.x, at.z - culledAt.z) > cullRebuildDist) {
        cullWalls(at.x, at.z);
      }

      let count = 0;
      let doorsMoved = false;
      for (const gdKey in doors) {
        if (count >= MAX_DOORS) break;
        const door = doors[gdKey];
        const ratio = openRatios[door.instanceId] ?? 0;
        doorsMoved ||= doorOpenValues[count] !== ratio || doorValues[count * 4] !== door.src.x;
        doorValues[count * 4 + 0] = door.src.x;
        doorValues[count * 4 + 1] = door.src.y;
        doorValues[count * 4 + 2] = door.dst.x;
        doorValues[count * 4 + 3] = door.dst.y;
        doorGapValues[count] = door.gapAtHighLambda === true ? 1 : 0;
        // by the door's own instance id, which is what `openRatioArray` is indexed by
        doorOpenValues[count] = ratio;
        count++;
      }

      const doorsChanged = doorsMoved === true || doorCount.value !== count;
      doorCount.value = count;
      if (doorsChanged === true) {
        doorSegs.value.needsUpdate = true;
        doorGaps.value.needsUpdate = true;
        doorOpen.value.needsUpdate = true;
      }

      // the table only depends on where the light stands and what the doors are doing, so with
      // both still it already holds the answer — and standing still is the common case
      if (swept === true && doorsChanged === false && moved < Number.EPSILON) {
        return;
      }
      swept = true;

      renderer.compute(sweep);
    },
  };
}

/**
 * How many directions the sweep resolves. A shadow edge lands within one of these of the truth.
 * - Still some flicker but 2048 + 1024 would fix it
 */
// const lightAngles = 1024 + 512;
const lightAngles = 2048 + 1024;
/** Cap on the walls handed to the sweep at once — the largest geomorph has under 400 */
const maxLightSegs = 4096;
/**
 * How far the light may wander before the walls within reach are chosen again, and the margin the
 * choice is made with — the second must exceed the first, or a wall can come into range unseen
 */
const cullRebuildDist = 2;
const cullMargin = 3;

/** How far the light reaches (metres) — the sweep stops there, and so does the polygon */
const lightRadius = 8;
/** How black an unseen fragment goes */
const unlitTint = 0.8;
/**
 * The cone they see best down — see `coneAt`. How much of the light is lost outside it, and how far
 * out the dimming takes hold: nearer than that the ground they stand on keeps its light whichever
 * way they turn
 */
const coneAmount = 0.7;
const coneFrom = lightRadius * 0.2;
/** Its half angle, and how many degrees either side that is softened over — enough to antialias */
const coneHalfDeg = 60;
const coneSoftDeg = 3;
const coneInnerCos = Math.cos(((coneHalfDeg - coneSoftDeg) * Math.PI) / 180);
const coneOuterCos = Math.cos(((coneHalfDeg + coneSoftDeg) * Math.PI) / 180);
/**
 * Lets a fragment sit exactly on the surface that occludes it without shadowing itself: a fixed
 * part, and a part that grows with the arc between two angles, which is where the error lives
 */
const lightBias = 0.02;
/** How many arcs wide the shadow boundary is softened over — under 1 it starts to snap again */
const penumbraArcs = 1.5;
/** Below this the ray and the segment are parallel, and the intersection means nothing */
const parallelUntil = 1e-6;

export type PlayerLight = {
  /**
   * Changes whenever the light is rebuilt. Materials capture its nodes when they are constructed,
   * so anything holding one must rebuild when this does — put it in the deps that make the
   * material, and an hmr of this file reaches the screen. See `WorldView`'s `reset`
   */
  uid: string;
  /**
   * Tints `color` towards black wherever the fragment cannot be seen from the light. Identity
   * whilst the light is off, so a material can wrap its colour unconditionally.
   */
  applyLight(color: THREE.Node<"vec3">): THREE.Node<"vec3">;
  /**
   * How lit a world XZ is, `0` to `1` — the polygon itself, for anything that has a world position
   * and wants to ask. Ignores whether the light is on, so a caller decides what an unlit light
   * means for itself.
   * @param outset grows the polygon by this many metres. It is star-shaped about the light, so
   * asking about a point pulled that much nearer is exactly a dilation
   */
  litAt(worldXZ: THREE.Node<"vec2">, outset?: number): THREE.Node<"float">;
  /** The same, for a material whose colour carries alpha — which is left alone */
  applyLightRgba(color: THREE.Node<"vec4">): THREE.Node<"vec4">;
  /**
   * Tints as though nothing were ever lit, for a surface the light has no business reaching — the
   * ceiling, which the sweep would otherwise light through the room below it
   */
  applyUnlitRgba(color: THREE.Node<"vec4">): THREE.Node<"vec4">;
  /** Re-reads the walls, which never move. Call on map change */
  syncWalls(gms: Geomorph.LayoutInstance[], gmsData: DerivedGmsData): void;
  /**
   * Where the light stands, which way it looks, and how open each door is, then the sweep itself.
   * Call once per rendered frame, before the render. `origin` of `null` turns the light off.
   * @param rotationY three's, as `npc.rotation.y` gives it — what is not ahead of it is dimmed
   */
  update(
    renderer: THREE.WebGPURenderer,
    origin: null | { x: number; z: number },
    rotationY: number,
    doors: Record<string, Geomorph.DoorState>,
    openRatios: Float32Array,
  ): void;
};
