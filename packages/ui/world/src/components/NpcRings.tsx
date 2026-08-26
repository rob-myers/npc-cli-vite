import { useStateRef } from "@npc-cli/util";
import { useContext } from "react";
import {
  attribute,
  cameraProjectionMatrix,
  cameraViewMatrix,
  float,
  mix,
  positionLocal,
  smoothstep,
  time,
  uv,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { MAX_NPCS, npcScale, npcShadowRadius } from "../const";
import { createXzQuad } from "../service/geometry";
import { WorldContext } from "./world-context";

export default function NpcRings() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      ...createRingResources(w.view.objectPick, w.view.foldNode),
      spawnRingByNpc: new Map(),
      selectRingByNpc: new Map(),

      onTick() {
        const now = time.value;
        let j = 0;

        // these rings are only shown during fade spawn
        for (const [npcKey, ring] of state.spawnRingByNpc) {
          if (faded(ring.fade, now) === true) {
            state.spawnRingByNpc.delete(npcKey);
            continue;
          }
          j = state.writeRing(j, ring.x, ring.y, ring.z, ring.fade, spawnRingRadius, spawnRingColor, spawnRingStyle);
        }

        // selector rings are persistent
        for (const [npcKey, ring] of state.selectRingByNpc) {
          const npc = w.n[npcKey];
          if (npc === undefined || faded(ring.fade, now) === true) {
            state.selectRingByNpc.delete(npcKey);
            continue;
          }
          const wanted = npc.isNotStanding() === true ? selectRingSeatedRadius : selectRingStandingRadius;
          retarget(ring.radius, wanted, selectRingMorphSecs, now);

          const { x, y, z } = npc.position;
          j = state.writeRing(j, x, y + selectRingLift, z, ring.fade, ring.radius, ring.color, selectRingStyle);
        }

        // Only the instances actually written go to the gpu. Without a range three uploads the
        // WHOLE buffer — every slot up to `MAX_RINGS`, whether or not a ring is in it — so a lone
        // ring cost the same as a world full of them. Three clears the ranges once it has uploaded
        state.ringGeo.instanceCount = j;
        state.ringBuffer.clearUpdateRanges();
        if (j > 0) {
          state.ringBuffer.addUpdateRange(0, j * ringStride);
          state.ringBuffer.needsUpdate = true;
        }
      },
      writeRing(index, x, y, z, fade, radius, color, style) {
        if (index >= MAX_RINGS) return index;
        // one contiguous run into the interleaved buffer — see `ringStride`
        const at = index * ringStride;
        const data = state.ringData;
        data[at + 0] = x;
        data[at + 1] = y;
        data[at + 2] = z;
        data[at + 3] = style.expand;
        data[at + 4] = fade.from;
        data[at + 5] = fade.to;
        data[at + 6] = fade.at;
        data[at + 7] = radius.from;
        data[at + 8] = radius.to;
        data[at + 9] = radius.at;
        data[at + 10] = color.r;
        data[at + 11] = color.g;
        data[at + 12] = color.b;
        data[at + 13] = style.alpha;
        return index + 1;
      },
      showSpawnRing(npcKey, at, y = spawnRingDefaultHeight) {
        // it is put up on a destination already chosen, so it is simply there
        state.spawnRingByNpc.set(npcKey, { x: at.x, y, z: at.y, fade: arrivedAt(1, time.value) });
      },
      fadeOutSpawnRing(npcKey) {
        state.fadeRing(state.spawnRingByNpc.get(npcKey), 0);
      },
      removeSpawnRing(npcKey) {
        state.spawnRingByNpc.delete(npcKey);
      },
      showSelectRing(npcKey, color) {
        const now = time.value;
        const ring = state.selectRingByNpc.get(npcKey);
        // recolouring one already up leaves it where it is rather than closing on them again
        if (ring !== undefined) {
          ring.color.set(color);
          state.fadeRing(ring, 1);
          return;
        }
        // from nothing, so it CLOSES onto them: the shader widens a ring as its opacity drops, so
        // fading one in draws it inwards — which reads as picking them out rather than appearing.
        // Its radius starts at whatever they are already doing, else it would slide into place too
        const radius = w.n[npcKey]?.isNotStanding() === true ? selectRingSeatedRadius : selectRingStandingRadius;
        const next = { color: new THREE.Color(color), fade: arrivedAt(0, now), radius: arrivedAt(radius, now) };
        state.selectRingByNpc.set(npcKey, next);
        state.fadeRing(next, 1);
      },
      hideSelectRing(npcKey) {
        state.fadeRing(state.selectRingByNpc.get(npcKey), 0);
      },
      clearSelectRings() {
        for (const ring of state.selectRingByNpc.values()) state.fadeRing(ring, 0);
      },
      fadeRing(ring, to) {
        if (ring === undefined) return;
        const now = time.value;
        retarget(ring.fade, to, ringFadeSecs, now);
        if (w.disabled === true) {
          ring.fade.from = ring.fade.to;
          ring.fade.at = now;
        }
      },
    }),
    {
      reset: {
        // ringGeo: true,
        // ringMat: true,
        // ringMesh: true,
        // ringData: true,
        // ringBuffer: true,
      },
    },
  );

  w.rings = state;

  return <primitive object={state.ringMesh} />;
}

/**
 * A value on its way from `from` to `to`, having set off at `at` on `time`'s clock.
 *
 * The whole journey is a pure function of that clock, so the shader draws it by itself and there
 * is nothing here to step: no per-frame easing, nothing that moves at the rate the ticks happen
 * to arrive, and the same curve however few frames it is drawn over. All the cpu does is say where
 * a value is headed, and only when that changes.
 */
export type Morph = { from: number; to: number; at: number };

/** A `Morph` that has nowhere to go */
function arrivedAt(value: number, now: number): Morph {
  return { from: value, to: value, at: now };
}

/** Where a morph stands right now — the same curve `morphNode` draws in the shader */
function morphAt(m: Morph, secs: number, now: number): number {
  const along = Math.min(Math.max((now - m.at) / secs, 0), 1);
  return m.from + (m.to - m.from) * along * along * (3 - 2 * along);
}

/**
 * Sends a morph off towards `wanted` from wherever it has got to, so a change of mind part way
 * across carries on from there rather than snapping back. A no-op if it is already headed there
 */
function retarget(m: Morph, wanted: number, secs: number, now: number): void {
  if (m.to === wanted) return;
  m.from = morphAt(m, secs, now);
  m.to = wanted;
  m.at = now;
}

/** Whether a fade has run all the way out, and the ring it belongs to can go */
function faded(fade: Morph, now: number): boolean {
  return fade.to === 0 && now - fade.at >= ringFadeSecs;
}

export type Ring = { fade: Morph };

/** What tells the two kinds of ring apart, in the `uv` the quad is measured in */
export type RingStyle = { alpha: number; expand: number };

export type State = {
  ringGeo: THREE.InstancedBufferGeometry;
  ringMat: THREE.MeshBasicNodeMaterial;
  ringMesh: THREE.Mesh;
  /** Every instance's every field, interleaved — see `ringStride` */
  ringData: Float32Array;
  ringBuffer: THREE.InstancedInterleavedBuffer;
  /** Per-npc spawn-destination ring shown during `fadeSpawn`, keyed by npcKey */
  spawnRingByNpc: Map<string, Ring & { x: number; y: number; z: number }>;
  /** Per-npc selection ring, which follows them until taken down — keyed by npcKey */
  selectRingByNpc: Map<string, Ring & { color: THREE.Color; radius: Morph }>;
  onTick(): void;
  /** Writes one instance and returns the next free index — both maps share the buffers */
  writeRing(
    index: number,
    x: number,
    y: number,
    z: number,
    fade: Morph,
    radius: Morph,
    color: THREE.Color,
    style: RingStyle,
  ): number;
  /** Show ring at ground point `at` (`at.y` is world z) and world-height `y`, fully visible */
  showSpawnRing(npcKey: string, at: { x: number; y: number }, y?: number): void;
  /** Start fading the ring out; it is auto-removed once fully faded */
  fadeOutSpawnRing(npcKey: string): void;
  /** Remove the ring immediately e.g. on teleport failure */
  removeSpawnRing(npcKey: string): void;
  /**
   * Pick this npc out with a ring of their own, in any colour `THREE.Color.set` takes — it follows
   * them until `hideSelectRing`. Naming one already selected recolours it in place
   */
  showSelectRing(npcKey: string, color: THREE.ColorRepresentation): void;
  /** Start fading this npc's select ring out; it is auto-removed once fully faded */
  hideSelectRing(npcKey: string): void;
  /** The same for every select ring that is up */
  clearSelectRings(): void;
  /** Sends a ring's opacity towards `to`, or straight there whilst the world is paused */
  fadeRing(ring: undefined | Ring, to: number): void;
};

/** How long a ring takes to fade all the way in or out */
const ringFadeSecs = 0.4;
/** Default ring height when target isn't doable (just above floor, avoids z-fighting) */
const spawnRingDefaultHeight = 0.02;
/** Both kinds share the instance buffer, and an npc can have one of each */
const MAX_RINGS = MAX_NPCS * 2;
/** Floats per instance: `ringPos` 4, `ringFade` 3, `ringRadius` 3, `ringRGBA` 4 — see `writeRing` */
const ringStride = 14;
/** How far a select ring floats above the npc's own feet, so it does not z-fight the floor */
const selectRingLift = 0.02;

/** The quad every ring is drawn on, whose `uv` is what the shader measures its radii in */
const ringQuadSide = npcScale * 1.6;
/** Metres, as the radii below are given in, into the `0..0.5` that `uv` spans from the centre */
const perMetre = 1 / ringQuadSide;

/**
 * How opaque each kind gets at its fullest. A select ring was asked for, so it reads stronger than
 * a spawn ring — but it stays TRANSLUCENT either way: it is a mark laid over the floor and whoever
 * stands on it, and a solid colour would read as a painted disc rather than as a highlight.
 * `expand` is what each gains by the time it has faded away.
 */
const spawnRingStyle: RingStyle = { alpha: 0.28 * 0.5, expand: 0.25 * perMetre };
const selectRingStyle: RingStyle = { alpha: 0.1, expand: 0.13 * perMetre };
const spawnRingColor = /* @__PURE__ */ new THREE.Color(0.4, 0.4, 0.4);
/** A spawn ring marks a patch of floor, and sits well within the npc arriving on it */
const spawnRingRadius: Morph = /* @__PURE__ */ arrivedAt(0.18 * perMetre, 0);
/**
 * What a select ring settles at, either side of the shadow: drawn well within it whilst they are
 * off their feet (`sit`, `lie`), and opened just past its edge whilst they are on them. `Secs` is
 * how long it takes to cross between the two, which the shader does by itself
 */
const selectRingSeatedRadius = npcShadowRadius * 0.7 * perMetre;
const selectRingStandingRadius = npcShadowRadius * 1.15 * perMetre;
const selectRingMorphSecs = 0.35;

function createRingResources(
  objectPick: THREE.UniformNode<"float", number>,
  fold: THREE.UniformNode<"float", number>,
): Pick<State, "ringGeo" | "ringMat" | "ringMesh" | "ringData" | "ringBuffer"> {
  const base = createXzQuad();
  const pos = base.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, (pos.getX(i) - 0.5) * ringQuadSide);
    pos.setZ(i, (pos.getZ(i) - 0.5) * ringQuadSide);
  }
  const ringGeo = new THREE.InstancedBufferGeometry();
  ringGeo.setAttribute("position", pos);
  ringGeo.setAttribute("uv", base.getAttribute("uv"));
  ringGeo.setIndex(base.getIndex());

  // INTERLEAVED, so an instance is one contiguous run and the four attributes are one buffer to
  // upload rather than four. `writeRing` is what fills it
  const ringData = new Float32Array(MAX_RINGS * ringStride);
  const ringBuffer = new THREE.InstancedInterleavedBuffer(ringData, ringStride, 1);
  ringGeo.setAttribute("ringPos", new THREE.InterleavedBufferAttribute(ringBuffer, 4, 0));
  ringGeo.setAttribute("ringFade", new THREE.InterleavedBufferAttribute(ringBuffer, 3, 4));
  ringGeo.setAttribute("ringRadius", new THREE.InterleavedBufferAttribute(ringBuffer, 3, 7));
  ringGeo.setAttribute("ringRGBA", new THREE.InterleavedBufferAttribute(ringBuffer, 4, 10));
  ringGeo.instanceCount = 0;

  const ringPos = attribute<"vec4">("ringPos", "vec4");
  const ringFade = attribute<"vec3">("ringFade", "vec3");
  const ringRadius = attribute<"vec3">("ringRadius", "vec3");
  const rgba = attribute<"vec4">("ringRGBA", "vec4");

  const worldPos = vec4(positionLocal.x.add(ringPos.x), ringPos.y, positionLocal.z.add(ringPos.z), 1.0);
  const clipPos = cameraProjectionMatrix.mul(cameraViewMatrix.mul(worldPos));

  // Both animations, drawn from the clock rather than stepped by anyone — see `Morph`
  const opacity = morphNode(ringFade, ringFadeSecs);
  const settledRadius = morphNode(ringRadius, selectRingMorphSecs);
  // and the radius grows further, by up to `expand`, as the ring fades out
  const expandedRadius = opacity.oneMinus().mul(ringPos.w).add(settledRadius);

  const dist = uv().sub(0.5).length();
  // annulus: 1 at expandedRadius, falling off to 0 across ringBandWidth on either side
  const band = float(1).sub(dist.sub(expandedRadius).abs().div(ringBandWidth).clamp(0, 1));
  const baseAlpha = band.mul(opacity).mul(rgba.w);
  const alpha = objectPick.notEqual(0).select(float(0), baseAlpha);

  const ringMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.FrontSide });
  ringMat.vertexNode = clipPos;
  // fades with the npc it belongs to whilst a map changes over — see `setWorldFold`
  ringMat.colorNode = vec4(rgba.xyz, alpha.mul(fold));

  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.frustumCulled = false;

  return { ringGeo, ringMat, ringMesh, ringData, ringBuffer };
}

/** Where a `Morph` packed as `[from, to, at]` stands now — the same curve `morphAt` reads */
function morphNode(packed: THREE.Node<"vec3">, secs: number): THREE.Node<"float"> {
  const along = time.sub(packed.z).div(secs).clamp(0, 1);
  return mix(packed.x, packed.y, smoothstep(float(0), float(1), along));
}

/** How thick the drawn line is, in metres — the same weight whatever radius it is drawn at */
const ringBandWidth = 0.045 * perMetre;
