import {
  Discard,
  Fn,
  float,
  mix,
  positionLocal,
  positionWorld,
  uniform,
  uniformArray,
  vec2,
  vec3,
  vec4,
} from "three/tsl";
import * as THREE from "three/webgpu";
import type { State as WorldType } from "../components/World";
import { helper } from "./helper";
import { arrivedAt, morphNode, retarget } from "./morph";
import { alwaysShownSlot, broadWallSlotOf, slotOf, totalSlots } from "./room-slots";

/**
 * During fade mode this computes faded in/out rooms.
 *
 * Per-room fade rather then per-fragment. Each instance of an instancedMesh in the world carries the slot of
 * the room it stands in as a static attribute — so a material reads an small array entry and is done.
 */
export function createFadeRooms(initialMode: FadeRoomsMode = "gm"): FadeRooms {
  /**
   * The clock every fade here is drawn against. Ours, not tsl's, which advances by the wall time
   * between RENDERS — so a fade begun after an idle spell would be handed all of it on its first
   * frame and arrive already over
   */
  const clockValue = uniform(nowSecs());
  const clockNode = float(clockValue);

  const morphs = Array.from({ length: totalSlots }, () => arrivedAt(1, nowSecs()));
  const morphValues = Array.from({ length: totalSlots }, () => new THREE.Vector3(1, 1, 0));
  const morphArray = uniformArray<"vec3">(morphValues, "vec3");

  // `1` in `"focus"` mode, where a room out of view goes rather than merely going black. A morph
  // rather than a plain uniform, so switching mode is a fade of its own
  const focusMorph = arrivedAt(initialMode === "focus" ? 1 : 0, nowSecs());
  const focusValue = uniform(new THREE.Vector3(focusMorph.from, focusMorph.to, focusMorph.at));
  const focusAmount = morphNode(focusValue, MODE_FADE_SECS, clockNode);

  // where each slot's wipe is centred and how far it reaches: world `xz` of the door the room is
  // seen through, then one over the way to its furthest corner. See `setWipeFrom`
  const wipeValues = Array.from({ length: totalSlots }, () => new THREE.Vector4(0, 0, 0, 0));
  const wipeArray = uniformArray<"vec4">(wipeValues, "vec4");
  /** How many rooms off the player each slot last stood — the order they go and come back in */
  const hopsBySlot = new Int32Array(totalSlots);
  /** Which map the fallback wipes were worked out for, they being static within one */
  let wipesFor = 0;

  const rooms: Geomorph.GmRoomId[] = [];
  /** Whilst set, frames are asked for — see `keepFramesComing` */
  let framesUntilMs = 0;
  let framesRaf = 0;

  function fadeAt(slot: THREE.Node<"float">) {
    return morphNode(morphArray.element(slot.toInt()), ROOM_FADE_SECS, clockNode);
  }

  return {
    uid: crypto.randomUUID(),
    mode: initialMode,
    rooms,
    getVisiblity: fadeAt,

    focusNode: focusAmount,

    applyWipe(node: never, fade: THREE.Node<"float">, slot: THREE.Node<"float">) {
      return Fn(() => {
        const wipe = wipeArray.element(slot.toInt());
        // 0 at the way into the room and 1 at its furthest corner
        const reach = vec2(positionWorld.x, positionWorld.z).sub(wipe.xy).length().mul(wipe.z);
        // shown only within `fade` of that way in, as light through a doorway would be. Outside
        // `"focus"` mode `focusAlpha` is 1, which is past the whole room
        Discard(reach.greaterThan(this.focusAlpha(fade)));
        return node;
      })();
    },

    focusAlpha(fade) {
      // `1` outside `"focus"`, so wrapping a material in this costs the other modes nothing
      return mix(float(1), fade, focusAmount);
    },

    fadeAtPair(slots) {
      return fadeAt(slots.x).max(fadeAt(slots.y));
    },

    applyFadeRgba(color, fade) {
      return vec4(color.rgb.mul(fade), color.a);
    },

    applyFadeAlpha(color, fade) {
      return vec4(color.rgb, color.a.mul(fade));
    },

    applySphereFade(node: never, fade: THREE.Node<"float">, centerY: number, radius: number, where?: never) {
      // A SPHERE about a point in the object's own space, growing with `fade`: everything outside
      // it is hidden, so a thing comes in from its middle outwards and goes back the same way.
      // Local rather than world, so it goes where the object goes — and for a skinned mesh
      // `positionLocal` is the skinned position, so it follows the pose rather than the bind
      return Fn(() => {
        const outside = positionLocal
          .sub(vec3(0, centerY, 0))
          .length()
          .greaterThan(fade.mul(radius));
        Discard(where === undefined ? outside : outside.and(where));
        return node;
      })();
    },

    dropPickWhenHidden(node: never, fade: THREE.Node<"float">, objectPick: THREE.Node<"float">) {
      return Fn(() => {
        Discard(objectPick.notEqual(0).and(fade.lessThan(0.5)));
        return node;
      })();
    },

    sync(w) {
      const inView = roomsInView(w);

      rooms.length = 0;
      if (inView !== null) rooms.push(...inView.map(({ room }) => room));

      // `focus` is `map` for now: both fade what the player cannot see, and only `gm` shows all
      const showAll = this.mode === "gm" || inView === null;
      const now = tick();

      // `gm` shows everything anyway, so it keeps whichever answer it had — and coming back out of
      // it, the floors are already where the mode returned to wants them
      if (this.mode !== "gm") {
        retarget(focusMorph, this.mode === "focus" ? 1 : 0, MODE_FADE_SECS, now);
        focusValue.value.set(focusMorph.from, focusMorph.to, focusMorph.at);
      }

      if (wipesFor !== w.gmsHash) syncWipes(w);
      // Only what is IN VIEW gets a fresh way in and a fresh place in the order. One on its way out
      // keeps the door it was last seen through, which is the door that has just shut on it
      for (const seen of inView ?? []) {
        const slot = slotOf(seen.room.gmId, seen.room.roomId);
        hopsBySlot[slot] = seen.hops;
        setWipeFrom(wipeValues[slot], w, seen);
      }

      const shown = new Set(rooms.map(({ gmId, roomId }) => slotOf(gmId, roomId)));
      // Broad walls are shown whenever an adjacent room is visible
      for (const [gmId, gm] of w.gms.entries()) {
        for (const [broadWallId, { roomIds }] of (w.gmsData.byKey[gm.key]?.broadWalls ?? []).entries()) {
          if (roomIds.some((roomId) => shown.has(slotOf(gmId, roomId)))) {
            shown.add(broadWallSlotOf(gmId, broadWallId));
          }
        }
      }

      // the furthest room off the player that is going, so the going can be ordered from there back
      let farthest = 0;
      for (let slot = 0; slot < totalSlots; slot++) {
        if (shown.has(slot) === false) farthest = Math.max(farthest, hopsBySlot[slot]);
      }

      let longestWait = 0;
      for (let slot = 0; slot < totalSlots; slot++) {
        const show = showAll === true || slot === alwaysShownSlot || shown.has(slot);
        // A room waits its turn either way: coming in they arrive NEAREST first, so the world opens
        // outwards from the player, and going out they leave FURTHEST first, so it folds back
        // towards them rather than stranding the near ones
        const waits = (show === true ? hopsBySlot[slot] : Math.max(farthest - hopsBySlot[slot], 0)) * ROOM_STAGGER_SECS;
        longestWait = Math.max(longestWait, waits);
        retarget(morphs[slot], show === true ? 1 : 0, ROOM_FADE_SECS, now, now + waits);
        morphValues[slot].set(morphs[slot].from, morphs[slot].to, morphs[slot].at);
      }

      keepFramesComing(w, longestWait);
    },
  };

  /**
   * The morphs are drawn from tsl's clock, which only moves when something renders — and the
   * frameloop renders on demand. So a fade has to ask for the frames it is drawn over.
   *
   * Its own loop rather than `World.onTick`, which stops with the world: a door opened whilst
   * everything is paused must still be seen to open
   */
  /** Where a room's wipe is centred once we know the door it is seen through */
  function setWipeFrom(out: THREE.Vector4, w: WorldType, { room, via }: RoomInView) {
    const gm = w.gms[room.gmId];
    if (via === null || gm === undefined) return; // their own room keeps the middle it was given
    const origin = via.astar.centroid;
    const outline = gm.rooms[room.roomId].outline.map((p) => gm.matrix.transformPoint(p.clone()));
    const reach = Math.max(...outline.map((p) => p.distanceTo(origin)), minWipeReach) * wipeOvershoot;
    out.set(origin.x, origin.y, 1 / reach, 0);
  }

  /** Where a room wipes from BEFORE anybody has seen it — its middle, for want of a door */
  function syncWipes(w: WorldType) {
    wipesFor = w.gmsHash;
    for (const [gmId, gm] of w.gms.entries()) {
      for (const [roomId, room] of gm.rooms.entries()) {
        const centre = gm.matrix.transformPoint(room.center);
        const outline = room.outline.map((p) => gm.matrix.transformPoint(p.clone()));
        const reach = Math.max(...outline.map((p) => p.distanceTo(centre)), minWipeReach) * wipeOvershoot;
        wipeValues[slotOf(gmId, roomId)].set(centre.x, centre.y, 1 / reach, 0);
      }
    }
  }

  function keepFramesComing(w: WorldType, waitingSecs = 0) {
    framesUntilMs = performance.now() + (ROOM_FADE_SECS + waitingSecs) * 1000 + 100;
    if (framesRaf !== 0) return;
    const frame = () => {
      tick(); // moved on before the frame that reads it
      w.r3f?.invalidate();
      framesRaf = performance.now() < framesUntilMs ? requestAnimationFrame(frame) : 0;
    };
    framesRaf = requestAnimationFrame(frame);
  }

  /** Moves the clock up to the wall, and gives what it now reads */
  function tick() {
    clockValue.value = nowSecs();
    return clockValue.value;
  }
}

/**
 * Which rooms the player's light reaches: their own, and whatever they could see from it.
 *
 * `gmRoomGraph` already joins a room to its doors and windows, and a hull door to the one facing it
 * in the next geomorph — so this is that graph walked outwards, stopping at any door that is SHUT.
 * A window is never stopped at, whatever it is doing, since it is glass — which is why
 * `service/player-light` leaves windows out of the occluders it sweeps, and why this must too.
 *
 * A walk of our own rather than `getReachableUpTo`, which gives the rooms but not the way IN to
 * each — and the way in is what a room's obstacles wipe from. Breadth first, so it is the shortest
 * way in, which is the one the player is looking through, and so that the count of rooms crossed to
 * reach it comes out with it. A shut door is reached and not passed through, so the shut doors
 * decide how far the light gets, over a graph of a couple of hundred nodes.
 *
 * `null` where there is no player to see from — which is not the same as an empty answer, and is
 * why this does not give one. See `sync`
 */
function roomsInView(w: WorldType): null | RoomInView[] {
  const gmRoomId = w.player === undefined ? undefined : w.e.npcToRoom.get(w.player.key);
  if (gmRoomId === undefined || w.gms[gmRoomId.gmId] === undefined) return null;

  const graph = w.gmRoomGraph;
  const root = graph.getNode(gmRoomId.grKey);
  if (root === null) return null;

  const seen = new Set([root]);
  const found: RoomInView[] = [{ room: gmRoomId, via: null, hops: 0 }];

  for (let frontier = [root], hops = 0; frontier.length > 0; hops++) {
    const next: Graph.GmRoomGraphNode[] = [];
    for (const node of frontier) {
      // a shut door is as far as the light gets: it is reached, and nothing beyond it is
      if (node.type === "door" && w.d[node.gdKey]?.open !== true) continue;
      for (const succ of graph.getSuccs(node)) {
        if (seen.has(succ) === true) continue;
        seen.add(succ);
        next.push(succ);
        if (succ.type === "room") {
          const room = helper.getGmRoomId(succ.gmId, succ.roomId);
          found.push({ room, via: node.type === "room" ? null : node, hops: Math.ceil((hops + 1) / 2) });
        }
      }
    }
    frontier = next;
  }

  return found;
}

/**
 * A room the player can see: the connector they see it through — `null` for the one they stand in —
 * and how many rooms off it stands, which is the order the rooms go and come back in
 */
type RoomInView = {
  room: Geomorph.GmRoomId;
  via: null | Graph.GmRoomGraphNodeDoor | Graph.GmRoomGraphNodeWindow;
  hops: number;
};

/** How long the switch between `"focus"` and `"map"` takes to play out, in seconds */
const MODE_FADE_SECS = 0.7;
/**
 * How much of the world is shown, cycled by the fade button and bound to keys `1`, `2` and `3`:
 * - `focus` — only what the player can see. FOR NOW the same as `map`
 * - `map` — what they cannot see goes black and stays, so the world still reads as a floorplan
 * - `gm` — all of it, all the time, as a game master sees it
 */
export type FadeRoomsMode = "focus" | "map" | "gm";

/** Which key selects which mode */
export const fadeRoomsModeByKey: Record<string, FadeRoomsMode> = {
  "1": "focus",
  "2": "map",
  "3": "gm",
};

/** The next mode round, for the fade button: `1` to `2` to `3` and back */
export function nextFadeRoomsMode(mode: FadeRoomsMode): FadeRoomsMode {
  return mode === "focus" ? "map" : mode === "map" ? "gm" : "focus";
}

/** `mode` if it is one, else the default — stored settings are not to be trusted */
export function parseFadeRoomsMode(mode: unknown): FadeRoomsMode {
  return mode === "focus" || mode === "map" || mode === "gm" ? mode : "gm";
}

/** The wall clock, in seconds */
function nowSecs() {
  return performance.now() / 1000;
}

/** How much later each room off the player goes or comes than the one before it, in seconds */
const ROOM_STAGGER_SECS = 0.2;
/** How small a room's wipe may be, so nothing divides by nothing */
const minWipeReach = 0.5;
/** How far past its furthest corner a wipe reaches, so it takes the whole room */
const wipeOvershoot = 1.05;
/** How long a room takes to fade in or out, in seconds */
const ROOM_FADE_SECS = 0.7;

export type FadeRooms = {
  /**
   * Changes whenever this is rebuilt. Anything that captured its nodes must be rebuilt with it —
   * see `PostProcessing`'s own `uid`, and every material that fades
   */
  uid: string;
  /**
   * How much of the world is shown. Plain CPU state, NOT a uniform: `sync` reads it and sends every
   * room where it belongs, so the shader is the same handful of instructions whichever mode it is
   * in and there is nothing per-fragment to switch on
   */
  mode: FadeRoomsMode;
  /** The rooms in view, whatever `mode` says — what the debug outlines are drawn for */
  rooms: Geomorph.GmRoomId[];
  /** How much of a thing in `slot` is shown, `1` being all of it — see `service/room-slots` */
  getVisiblity(slot: THREE.Node<"float">): THREE.Node<"float">;
  /**
   * `node`, with whatever stands beyond `slot`'s WIPE discarded — a circle about the door the room
   * is seen through, growing as the room comes into view and shrinking back to that door as it
   * goes. Nothing at all outside `"focus"` mode, where the circle takes in the whole room.
   *
   * Only for what has a meaningful `positionWorld`: a billboard expanded in a `vertexNode` does not
   */
  applyWipe<T extends THREE.Node<"float"> | THREE.Node<"vec3"> | THREE.Node<"vec4">>(
    node: T,
    fade: THREE.Node<"float">,
    slot: THREE.Node<"float">,
  ): T;
  /** `1` in `"focus"` mode and `0` in the others, easing between the two as the mode changes */
  focusNode: THREE.Node<"float">;
  /**
   * What a room's ALPHA is taken by as it goes: `fade` in `"focus"`, where it leaves altogether,
   * and `1` in the others, where it goes black and stays put
   */
  focusAlpha(fade: THREE.Node<"float">): THREE.Node<"float">;
  /** The more opaque of the two slots: walls are (x, x) but in connectors (x, y) satisfies x ≠ y */
  fadeAtPair(slots: THREE.Node<"vec2">): THREE.Node<"float">;
  /**
   * `color` with its COLOUR taken by `fade` — black where a room is hidden, its own where it is
   * shown, and its alpha untouched either way.
   *
   * Nothing changes how solid it is, so nothing half-covers anything: no sorting, no blending, no
   * depth written by something that is barely there. A hidden room goes black rather than absent,
   * which against the near-black backdrop reads as absent anyway
   */
  applyFadeRgba(color: THREE.Node<"vec4">, fade: THREE.Node<"float">): THREE.Node<"vec4">;
  /**
   * `color` with its ALPHA taken by `fade` instead — for the FLOOR, which lies under everything and
   * so can go without hiding anything behind it. Blacking it out would leave a black floor where
   * the backdrop should be showing through
   */
  applyFadeAlpha(color: THREE.Node<"vec4">, fade: THREE.Node<"float">): THREE.Node<"vec4">;
  /**
   * `node`, with whatever lies outside a GROWING SPHERE discarded — centred `centerY` up the
   * object's own space and reaching `radius` at a `fade` of 1, so a thing arrives from its middle
   * outwards and leaves inwards.
   *
   * Measured in LOCAL space, so it moves with the object rather than standing still in the world
   */
  applySphereFade<T extends THREE.Node<"float"> | THREE.Node<"vec3"> | THREE.Node<"vec4">>(
    node: T,
    fade: THREE.Node<"float">,
    centerY: number,
    radius: number,
    /**
     * Where the cut applies, for a material whose fragments are not all the same thing. A discard
     * takes the fragment whatever branch of a `select` it sits in, so anything else sharing the
     * material — a billboarded label, say — must be excluded here or it goes with the body
     */
    where?: THREE.Node<"bool">,
  ): T;
  /**
   * `node`, with the fragment discarded whilst PICKING if its room is hidden — so a click passes
   * through a room it cannot see and lands on whatever is behind, which is the floor.
   *
   * Needed because a hidden room is blacked out rather than made transparent: its alpha is what it
   * always was, so without this it would go on writing pick ids as solidly as ever. A discard
   * rather than a zero alpha: the pick target is not multisampled, so coverage does nothing there.
   *
   * Wrap whichever node a material already has; the value comes back untouched
   */
  dropPickWhenHidden<T extends THREE.Node<"float"> | THREE.Node<"vec3"> | THREE.Node<"vec4">>(
    node: T,
    fade: THREE.Node<"float">,
    objectPick: THREE.Node<"float">,
  ): T;
  /** Re-reads which rooms are in view and sends their fades off. Cheap, but not per frame */
  sync(w: WorldType): void;
};
