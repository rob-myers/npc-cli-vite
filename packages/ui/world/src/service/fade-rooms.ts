import { time, uniformArray, vec4 } from "three/tsl";
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
export function createFadeRooms(enabledInitially = false): FadeRooms {
  const morphs = Array.from({ length: totalSlots }, () => arrivedAt(1, 0));
  const morphValues = Array.from({ length: totalSlots }, () => new THREE.Vector3(1, 1, 0));
  const morphArray = uniformArray<"vec3">(morphValues, "vec3");

  const rooms: Geomorph.GmRoomId[] = [];
  /** Whilst set, frames are asked for — see `keepFramesComing` */
  let framesUntilMs = 0;
  let framesRaf = 0;

  function fadeAt(slot: THREE.Node<"float">) {
    return morphNode(morphArray.element(slot.toInt()), ROOM_FADE_SECS);
  }

  return {
    uid: crypto.randomUUID(),
    enabled: enabledInitially === true,
    rooms,
    getVisiblity: fadeAt,

    fadeAtPair(slots) {
      return fadeAt(slots.x).max(fadeAt(slots.y));
    },

    applyFadeRgba(color, fade) {
      return vec4(color.rgb, color.a.mul(fade));
    },

    sync(w) {
      const inView = roomsInView(w);

      rooms.length = 0;
      if (inView !== null) rooms.push(...inView);

      const showAll = this.enabled === false || inView === null;
      const now = time.value;

      const shown = new Set(rooms.map(({ gmId, roomId }) => slotOf(gmId, roomId)));
      // Broad walls are shown whenever an adjacent room is visible
      for (const [gmId, gm] of w.gms.entries()) {
        for (const [broadWallId, { roomIds }] of (w.gmsData.byKey[gm.key]?.broadWalls ?? []).entries()) {
          if (roomIds.some((roomId) => shown.has(slotOf(gmId, roomId)))) {
            shown.add(broadWallSlotOf(gmId, broadWallId));
          }
        }
      }

      for (let slot = 0; slot < totalSlots; slot++) {
        const next = showAll === true || slot === alwaysShownSlot || shown.has(slot) ? 1 : 0;
        retarget(morphs[slot], next, ROOM_FADE_SECS, now);
        morphValues[slot].set(morphs[slot].from, morphs[slot].to, morphs[slot].at);
      }

      keepFramesComing(w);
    },
  };

  /**
   * The morphs are drawn from tsl's clock, which only moves when something renders — and the
   * frameloop renders on demand. So a fade has to ask for the frames it is drawn over.
   *
   * Its own loop rather than `World.onTick`, which stops with the world: a door opened whilst
   * everything is paused must still be seen to open
   */
  function keepFramesComing(w: WorldType) {
    framesUntilMs = performance.now() + ROOM_FADE_SECS * 1000 + 100;
    if (framesRaf !== 0) return;
    const tick = () => {
      w.r3f?.invalidate();
      framesRaf = performance.now() < framesUntilMs ? requestAnimationFrame(tick) : 0;
    };
    framesRaf = requestAnimationFrame(tick);
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
 * `getReachableUpTo` keeps the node it stops on and takes none of its successors, so a shut door is
 * reached and not passed through. Rooms are counted as they are met and the walk gives up once
 * `MAX_FADED_IN_ROOMS` have been, rather than expanding the whole reachable map and slicing after —
 * with every door on a large map open, that is every room in it.
 *
 * `null` where there is no player to see from — which is not the same as an empty answer, and is
 * why this does not give one. See `sync`
 */
function roomsInView(w: WorldType): null | Geomorph.GmRoomId[] {
  const gmRoomId = w.player === undefined ? undefined : w.e.npcToRoom.get(w.player.key);
  if (gmRoomId === undefined || w.gms[gmRoomId.gmId] === undefined) return null;

  let roomsSeen = 0;
  return w.gmRoomGraph
    .getReachableUpTo(gmRoomId.grKey, (node) => {
      if (node.type === "room") return ++roomsSeen >= MAX_FADED_IN_ROOMS;
      return node.type === "door" && w.d[node.gdKey]?.open !== true;
    })
    .flatMap((node) => (node.type === "room" ? helper.getGmRoomId(node.gmId, node.roomId) : []))
    .slice(0, MAX_FADED_IN_ROOMS);
}

/** How long a room takes to fade in or out, in seconds */
const ROOM_FADE_SECS = 1;

const MAX_FADED_IN_ROOMS = 12;

export type FadeRooms = {
  /**
   * Changes whenever this is rebuilt. Anything that captured its nodes must be rebuilt with it —
   * see `PostProcessing`'s own `uid`, and every material that fades
   */
  uid: string;
  /**
   * Whether the world is shown by room rather than faded on a circle about the player. A plain
   * boolean, NOT a uniform: switching it off sends every room to `1`, so the shader is the same
   * handful of instructions either way and there is nothing per-fragment to switch on
   */
  enabled: boolean;
  /** The rooms in view, whatever `enabled` says — what the debug outlines are drawn for */
  rooms: Geomorph.GmRoomId[];
  /** How much of a thing in `slot` is shown, `1` being all of it — see `service/room-slots` */
  getVisiblity(slot: THREE.Node<"float">): THREE.Node<"float">;
  /** The more opaque of the two slots: walls are (x, x) but in connectors (x, y) satisfies x ≠ y */
  fadeAtPair(slots: THREE.Node<"vec2">): THREE.Node<"float">;
  /** `color` with its alpha taken by `fade` */
  applyFadeRgba(color: THREE.Node<"vec4">, fade: THREE.Node<"float">): THREE.Node<"vec4">;
  /** Re-reads which rooms are in view and sends their fades off. Cheap, but not per frame */
  sync(w: WorldType): void;
};
