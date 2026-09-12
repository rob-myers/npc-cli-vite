import { useStateRef } from "@npc-cli/util";
import { useFrame } from "@react-three/fiber";
import { useContext, useMemo } from "react";
import { attribute, cameraProjectionMatrix, cameraViewMatrix, float, positionLocal, time, uv, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import { MAX_NPCS, npcScale, npcShadowRadius } from "../const";
import { createXzQuad } from "../service/geometry";
import { arrivedAt, type Morph, morphNode, retarget, settled } from "../service/morph";
import { alwaysShownSlot, slotOf } from "../service/room-slots";
import { WorldContext } from "./world-context";

export default function NpcRings() {
  const w = useContext(WorldContext);

  const state = useStateRef(
    (): State => ({
      ...createRingResources(w.view.objectPick, w.view.foldNode),
      pickRings: [],
      selectRingByNpc: new Map(),
      spawnRingByNpc: new Map(),

      clearSelectRings() {
        for (const ring of state.selectRingByNpc.values()) state.fadeRing(ring, 0);
      },
      fadeOutSpawnRing(npcKey) {
        state.fadeRing(state.spawnRingByNpc.get(npcKey), 0);
      },
      fadeRing(ring, to) {
        if (ring === undefined) return;
        const now = time.value;
        retarget(ring.fade, to, ring.fadeSecs, now);
        if (w.disabled === true) {
          ring.fade.from = ring.fade.to;
          ring.fade.at = now;
        }
      },
      hideSelectRing(npcKey) {
        state.fadeRing(state.selectRingByNpc.get(npcKey), 0);
      },
      onTick() {
        const now = time.value;
        let j = 0;

        // spawn rings mark a destination during a fade spawn, and go once faded out
        for (const [npcKey, ring] of state.spawnRingByNpc) {
          if (faded(ring, now) === true) state.spawnRingByNpc.delete(npcKey);
          else j = state.writeRing(j, ring);
        }

        // pick rings mark picks: the latest stays up, and the rest fade once superseded
        state.pickRings = state.pickRings.filter((ring) => faded(ring, now) === false);
        for (const ring of state.pickRings) j = state.writeRing(j, ring);

        // select rings follow their npc until taken down
        for (const [npcKey, ring] of state.selectRingByNpc) {
          const npc = w.n[npcKey];
          if (npc === undefined || faded(ring, now) === true) {
            state.selectRingByNpc.delete(npcKey);
            continue;
          }
          const wanted = npc.isNotStanding() === true ? selectRingSeatedRadius : selectRingStandingRadius;
          retarget(ring.radius, wanted, selectRingMorphSecs, now);
          // read every tick, unlike the others': an npc walks from one room to the next
          ring.x = npc.position.x;
          ring.y = npc.position.y + selectRingLift;
          ring.z = npc.position.z;
          ring.roomSlot = npc.roomSlot.value;
          j = state.writeRing(j, ring);
        }

        // Only the instances actually written go to the gpu. Without a range three uploads the
        // WHOLE buffer — every slot up to `MAX_RINGS`, whether or not a ring is in it — so a lone
        // ring cost the same as a world full of them. Three clears the ranges once it has uploaded
        state.ringGeo.instanceCount = j;
        state.ringMesh.visible = j > 0; // no rings up: no draw call at all
        state.ringBuffer.clearUpdateRanges();
        if (j > 0) {
          state.ringBuffer.addUpdateRange(0, j * ringStride);
          state.ringBuffer.needsUpdate = true;
        }
      },
      pickRingPoint(pick) {
        const { meta } = pick;
        if (meta.type === "npc") {
          // on the floor beneath them, rather than wherever on them the pick landed
          const npc = w.n[meta.npcKey];
          if (npc !== undefined) return { x: npc.position.x, y: npc.position.y, z: npc.position.z };
        } else if (meta.type === "door") {
          // in the doorway, whichever leaf or edge of the door was hit
          const door = w.d[meta.gdKey];
          if (door !== undefined) return { x: (door.src.x + door.dst.x) / 2, y: 0, z: (door.src.y + door.dst.y) / 2 };
        }
        return { x: pick.point[0], y: pick.point[1], z: pick.point[2] };
      },
      removeSpawnRing(npcKey) {
        state.spawnRingByNpc.delete(npcKey);
      },
      showPickRing(pick) {
        const now = time.value;
        const at = state.pickRingPoint(pick);
        // the oldest gives way to a burst of picks, rather than the newest going unmarked
        if (state.pickRings.length >= MAX_PICK_RINGS) state.pickRings.shift();
        // the one that was latest is no longer, so it starts out — and not snapped whilst paused,
        // as `fadeRing` would: the frame hook below sees it out
        const previous = state.pickRings.at(-1);
        if (previous !== undefined) retarget(previous.fade, 0, previous.fadeSecs, now);
        // the new one simply stays, until it is superseded in turn. It marks where the pick
        // landed, faded room or not, so it is not given that room's slot
        state.pickRings.push({
          ...pickRingLook,
          x: at.x,
          y: at.y + pickRingLift,
          z: at.z,
          roomSlot: alwaysShownSlot,
          fade: arrivedAt(1, now),
        });
        // drawn at once: the tick that would otherwise write it does not run whilst the world is
        // paused
        state.onTick();
        w.r3f?.invalidate();
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
        // Its radius starts at whatever they are already doing, else it would slide into place too.
        // Where it is, and whose room, are read every tick
        const radius = w.n[npcKey]?.isNotStanding() === true ? selectRingSeatedRadius : selectRingStandingRadius;
        const next: RingInstance = {
          ...selectRingLook,
          x: 0,
          y: 0,
          z: 0,
          roomSlot: alwaysShownSlot,
          fade: arrivedAt(0, now),
          radius: arrivedAt(radius, now),
          color: new THREE.Color(color),
        };
        state.selectRingByNpc.set(npcKey, next);
        state.fadeRing(next, 1);
      },
      showSpawnRing(npcKey, at, y = spawnRingDefaultHeight) {
        // it marks a patch of FLOOR, so its room is settled once here rather than read per tick as
        // a select ring's is — and the npc it is for may not have arrived to be asked
        const gmRoomId = w.e.findRoomContaining({ x: at.x, y: at.y }, true);
        const roomSlot = gmRoomId === null ? alwaysShownSlot : slotOf(gmRoomId.gmId, gmRoomId.roomId);
        // it is put up on a destination already chosen, so it is simply there
        state.spawnRingByNpc.set(npcKey, {
          ...spawnRingLook,
          x: at.x,
          y,
          z: at.y,
          roomSlot,
          fade: arrivedAt(1, time.value),
        });
      },
      writeRing(index, ring) {
        if (index >= MAX_RINGS) return index;
        // one contiguous run into the interleaved buffer — see `ringStride`
        const at = index * ringStride;
        const data = state.ringData;
        data[at + 0] = ring.x;
        data[at + 1] = ring.y;
        data[at + 2] = ring.z;
        data[at + 3] = ring.style.expand;
        data[at + 4] = ring.fade.from;
        data[at + 5] = ring.fade.to;
        data[at + 6] = ring.fade.at;
        data[at + 7] = ring.fadeSecs;
        data[at + 8] = ring.radius.from;
        data[at + 9] = ring.radius.to;
        data[at + 10] = ring.radius.at;
        data[at + 11] = ring.color.r;
        data[at + 12] = ring.color.g;
        data[at + 13] = ring.color.b;
        data[at + 14] = ring.style.alpha;
        data[at + 15] = ring.roomSlot;
        return index + 1;
      },
    }),
  );

  w.rings = state;

  // a paused world runs no tick, yet a pick ring superseded whilst paused must still fade out —
  // so whilst any is FADING, the frames write them instead, and ask for the next. The latest stays
  // up for good, which must not keep the frames coming
  useFrame(() => {
    if (w.disabled === true && state.pickRings.some((ring) => ring.fade.to === 0)) {
      state.onTick();
      w.r3f?.invalidate();
    }
  });

  useMemo(() => {
    state.ringMat.colorNode = state.colorNode.mul(w.view.fadeRoomsFx.getVisiblity(state.roomSlot));
    state.ringMat.needsUpdate = true;
  }, [w.view.fadeRoomsFx.uid]);

  return <primitive object={state.ringMesh} />;
}

/** Whether a ring has faded all the way out, and can go */
function faded(ring: RingInstance, now: number): boolean {
  return ring.fade.to === 0 && settled(ring.fade, ring.fadeSecs, now);
}

/** What tells the kinds of ring apart, in the `uv` the quad is measured in */
export type RingStyle = { alpha: number; expand: number };

/** What a kind of ring is drawn with, which every ring of that kind starts from — see `RingInstance` */
type RingLook = Pick<RingInstance, "style" | "color" | "radius" | "fadeSecs">;

/** One ring, of any kind: exactly what `writeRing` puts in the buffer */
export type RingInstance = {
  x: number;
  y: number;
  z: number;
  roomSlot: number;
  fade: Morph;
  /** How long its fade takes — each ring carries its own, the floor's being slow */
  fadeSecs: number;
  radius: Morph;
  color: THREE.Color;
  style: RingStyle;
};

export type State = {
  ringGeo: THREE.InstancedBufferGeometry;
  ringMat: THREE.MeshBasicNodeMaterial;
  ringMesh: THREE.Mesh;
  /** Every instance's every field, interleaved — see `ringStride` */
  ringData: Float32Array;
  ringBuffer: THREE.InstancedInterleavedBuffer;
  /** Per-npc spawn-destination ring shown during `fadeSpawn`, keyed by npcKey */
  spawnRingByNpc: Map<string, RingInstance>;
  /** Per-npc selection ring, which follows them until taken down — keyed by npcKey */
  selectRingByNpc: Map<string, RingInstance>;
  /** Where picks have landed, oldest first — the latest stays up, the rest fade once superseded */
  pickRings: RingInstance[];

  colorNode: THREE.VarNode<"vec4", THREE.JoinNode<"vec4">>;
  roomSlot: THREE.AttributeNode<"float">;

  onTick(): void;
  /** Writes one instance and returns the next free index — every kind shares the buffer */
  writeRing(index: number, ring: RingInstance): number;
  /** Show ring at ground point `at` (`at.y` is world z) and world-height `y`, fully visible */
  showSpawnRing(npcKey: string, at: { x: number; y: number }, y?: number): void;
  /** Start fading the ring out; it is auto-removed once fully faded */
  fadeOutSpawnRing(npcKey: string): void;
  /** Remove the ring immediately e.g. on teleport failure */
  removeSpawnRing(npcKey: string): void;
  /** Mark where a pick landed with a ring — it stays until the next pick, then fades. See `pickRingPoint` */
  showPickRing(pick: JshCli.PickEvent): void;
  /** Where a pick's ring goes: the floor beneath an npc, a door's doorway, else where the pick hit */
  pickRingPoint(pick: JshCli.PickEvent): { x: number; y: number; z: number };
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
  fadeRing(ring: undefined | RingInstance, to: number): void;
};

/** How long a ring takes to fade all the way in or out */
const ringFadeSecs = 0.4;
/** Default ring height when target isn't doable (just above floor, avoids z-fighting) */
const spawnRingDefaultHeight = 0.02;
/** How many picks are marked at once — the oldest gives way */
const MAX_PICK_RINGS = 8;
/** All kinds share the instance buffer, and an npc can have a spawn ring and a select ring */
const MAX_RINGS = MAX_NPCS * 2 + MAX_PICK_RINGS;
/**
 * Floats per instance: `ringPos` 4, `ringFade` 4, `ringRadius` 3, `ringRGBA` 4, `ringRoomSlot` 1 —
 * see `writeRing`
 */
const ringStride = 16;
/** How far a select ring floats above the npc's own feet, so it does not z-fight the floor */
const selectRingLift = 0.02;
/** How far a pick ring floats above whatever it marks, likewise */
const pickRingLift = 0.02;

/** The quad every ring is drawn on, whose `uv` is what the shader measures its radii in */
const ringQuadSide = npcScale * 1.6;
/** Metres, as the radii below are given in, into the `0..0.5` that `uv` spans from the centre */
const perMetre = 1 / ringQuadSide;

/**
 * How opaque each kind gets at its fullest. A select ring was asked for, so it reads stronger than
 * a spawn ring — but it stays TRANSLUCENT either way: it is a mark laid over the floor and whoever
 * stands on it, and a solid colour would read as a painted disc rather than as a highlight.
 * `expand` is what each gains by the time it has faded away.
 *
 * A spawn ring marks a patch of floor, and sits well within the npc arriving on it
 */
const spawnRingLook: RingLook = {
  style: { alpha: 0.28 * 0.5, expand: 0.25 * perMetre },
  color: /* @__PURE__ */ new THREE.Color(0.4, 0.4, 0.4),
  radius: /* @__PURE__ */ arrivedAt(0.18 * perMetre, 0),
  fadeSecs: ringFadeSecs,
};
/**
 * A pick ring marks where the last pick landed, and stays until the next pick — then it fades, in
 * alpha alone. Its look, all in one place:
 */
const pickRingConfig = {
  /** Metres, on the ground */
  radius: 0.01,
  /**
   * How opaque it is whilst up, `0..1`. The colour only reads above ~0.4: the line's profile
   * (`ringBandWidth`) is wider than this radius, so most of the mark is its soft edge, and a faint
   * one comes out as a grey smudge whatever the colour
   */
  alpha: 0.5,
  color: /* @__PURE__ */ new THREE.Color(0.1, 0.1, 0.1),
  /** How long a superseded ring takes to fade away — its own pace, not `ringFadeSecs` */
  fadeSecs: 1,
};
const pickRingLook: RingLook = {
  style: { alpha: pickRingConfig.alpha, expand: 0 },
  color: pickRingConfig.color,
  radius: /* @__PURE__ */ arrivedAt(pickRingConfig.radius * perMetre, 0),
  fadeSecs: pickRingConfig.fadeSecs,
};
/**
 * A select ring's colour and radius are its own — see `showSelectRing` — so these are placeholders.
 * It settles either side of the shadow: drawn well within it whilst they are off their feet
 * (`sit`, `lie`), and opened just past its edge whilst they are on them. `MorphSecs` is how long
 * it takes to cross between the two, which the shader does by itself
 */
const selectRingLook: RingLook = {
  style: { alpha: 0.1, expand: 0.13 * perMetre },
  color: /* @__PURE__ */ new THREE.Color(),
  radius: /* @__PURE__ */ arrivedAt(0, 0),
  fadeSecs: ringFadeSecs,
};
const selectRingSeatedRadius = npcShadowRadius * 0.7 * perMetre;
const selectRingStandingRadius = npcShadowRadius * 1.15 * perMetre;
const selectRingMorphSecs = 0.35;

function createRingResources(
  objectPick: THREE.UniformNode<"float", number>,
  fold: THREE.UniformNode<"float", number>,
): Pick<State, "ringGeo" | "ringMat" | "ringMesh" | "ringData" | "ringBuffer" | "colorNode" | "roomSlot"> {
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

  // INTERLEAVED, so an instance is one contiguous run and the attributes are one buffer to upload
  // rather than five. `writeRing` is what fills it
  const ringData = new Float32Array(MAX_RINGS * ringStride);
  const ringBuffer = new THREE.InstancedInterleavedBuffer(ringData, ringStride, 1);
  ringGeo.setAttribute("ringPos", new THREE.InterleavedBufferAttribute(ringBuffer, 4, 0));
  ringGeo.setAttribute("ringFade", new THREE.InterleavedBufferAttribute(ringBuffer, 4, 4));
  ringGeo.setAttribute("ringRadius", new THREE.InterleavedBufferAttribute(ringBuffer, 3, 8));
  ringGeo.setAttribute("ringRGBA", new THREE.InterleavedBufferAttribute(ringBuffer, 4, 11));
  ringGeo.setAttribute("ringRoomSlot", new THREE.InterleavedBufferAttribute(ringBuffer, 1, 15));
  ringGeo.instanceCount = 0;

  const ringPos = attribute<"vec4">("ringPos", "vec4");
  // `[from, to, at, secs]` — a `Morph`, and how long it takes, which is each ring's own
  const ringFade = attribute<"vec4">("ringFade", "vec4");
  const ringRadius = attribute<"vec3">("ringRadius", "vec3");
  const rgba = attribute<"vec4">("ringRGBA", "vec4");
  const roomSlot = attribute<"float">("ringRoomSlot", "float");

  const worldPos = vec4(positionLocal.x.add(ringPos.x), ringPos.y, positionLocal.z.add(ringPos.z), 1.0);
  const clipPos = cameraProjectionMatrix.mul(cameraViewMatrix.mul(worldPos));

  // Both animations, drawn from the clock rather than stepped by anyone — see `Morph`
  const opacity = morphNode(ringFade.xyz, ringFade.w);
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

  const colorNode = vec4(rgba.xyz, alpha.mul(fold));

  const ringMesh = new THREE.Mesh(ringGeo, ringMat);
  ringMesh.frustumCulled = false;

  return {
    ringGeo,
    ringMat,
    ringMesh,
    ringData,
    ringBuffer,
    //
    colorNode,
    roomSlot,
  };
}

/** How thick the drawn line is, in metres — the same weight whatever radius it is drawn at */
const ringBandWidth = 0.045 * perMetre;
