import { time, uniformArray, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import type DerivedGmsData from "./DerivedGmsData";
import type { GmGraph } from "./gm-graph";
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
    return morphNode(morphArray.element(slot.toInt()), fadeSecs);
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

      // With nobody to see from, the world is shown WHOLE rather than hidden entirely: `null` is
      // "we do not know where the player is" — before they have spawned, or between maps — which
      // is not the same as "they can see nothing". Hiding it then would fade the world out and
      // straight back in as the player arrives, over the top of the intro
      const showAll = this.enabled === false || inView === null;

      const now = time.value;
      const shown = new Set(rooms.map(({ gmId, roomId }) => slotOf(gmId, roomId)));

      // Broad walls may abut may rooms and is shown whilst any of them is
      for (const [gmId, gm] of w.gms.entries()) {
        for (const [broadWallId, { roomIds }] of (w.gmsData.byKey[gm.key]?.broadWalls ?? []).entries()) {
          if (roomIds.some((roomId) => shown.has(slotOf(gmId, roomId)))) {
            shown.add(broadWallSlotOf(gmId, broadWallId));
          }
        }
      }

      for (let slot = 0; slot < totalSlots; slot++) {
        const wanted = showAll === true || slot === alwaysShownSlot || shown.has(slot) ? 1 : 0;
        retarget(morphs[slot], wanted, fadeSecs, now);
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
  function keepFramesComing(w: WorldLike) {
    framesUntilMs = performance.now() + fadeSecs * 1000 + 100;
    if (framesRaf !== 0) return;
    const tick = () => {
      w.r3f?.invalidate();
      framesRaf = performance.now() < framesUntilMs ? requestAnimationFrame(tick) : 0;
    };
    framesRaf = requestAnimationFrame(tick);
  }
}

/**
 * Which rooms the player's light reaches: their own, and whatever they can see into from it.
 *
 * An OPEN door joins two rooms and a shut one does not. A WINDOW always joins them, whatever it is
 * doing, since it is glass — which is why `service/player-light` leaves windows out of the occluders
 * it sweeps, and why this must follow them too.
 *
 * The walk carries on from each room it reaches: light through a door into the next room goes on
 * through THAT room's window into a third, and through hull doors into the next geomorph
 * altogether. Breadth-first, so the cap keeps the nearest rooms.
 *
 * `null` where there is no player to see from — which is not the same as an empty answer, and is
 * why this does not give one. See `sync`
 */
function roomsInView(w: WorldLike): null | Geomorph.GmRoomId[] {
  const at = w.player === undefined ? undefined : w.e.npcToRoom.get(w.player.key);
  if (at === undefined || w.gms[at.gmId] === undefined) return null;

  const openDoors = Object.values(w.d).filter((door) => door.open === true);

  const out = [at];
  const seen = new Set([at.grKey]);
  // `out` is both the answer and the queue — appending whilst walking it is what makes this
  // breadth-first, since a room's neighbours land after every room already found
  for (let i = 0; i < out.length && out.length < MAX_FADED_IN_ROOMS; i++) {
    for (const next of roomsJoining(w, out[i], openDoors)) {
      if (seen.has(next.grKey) === true) continue;
      seen.add(next.grKey);
      if (out.push(next) >= MAX_FADED_IN_ROOMS) break;
    }
  }

  return out;
}

/** What `from` is joined to: through its own geomorph's open doors and windows, and across a hull door */
function* roomsJoining(w: WorldLike, from: Geomorph.GmRoomId, openDoors: Geomorph.DoorState[]) {
  const gm = w.gms[from.gmId];
  if (gm === undefined) return;

  for (const door of openDoors) {
    if (door.gmId !== from.gmId) continue;
    if (door.hull === true) {
      // a hull door's far side lies in the NEXT geomorph, which its own `roomIds` cannot name — it
      // reads `null` there, and only the graph joining the geomorphs knows what is through it
      if (door.connector.roomIds.includes(from.roomId) === false) continue;
      const adj = w.gmGraph.getAdjacentRoomCtxt(from.gmId, door.doorId);
      if (adj !== null) yield helper.getGmRoomId(adj.adjGmId, adj.adjRoomId);
      continue;
    }
    const roomId = otherRoom(gm, door.connector, from.roomId);
    if (roomId !== null) yield helper.getGmRoomId(from.gmId, roomId);
  }

  for (const window of gm.windows ?? []) {
    const roomId = otherRoom(gm, window, from.roomId);
    if (roomId !== null) yield helper.getGmRoomId(from.gmId, roomId);
  }
}

/**
 * The room on the far side of `connector` from `roomId`, or `null` if it joins somewhere else — or
 * nowhere, as a window onto the outside of the hull does.
 *
 * `roomIds` comes from `findRoomIdContaining` on the two entries, and a side can read `null` where
 * a room does exist — an entry landing on a threshold. So a `null` is asked of the polygons again.
 */
function otherRoom(gm: Geomorph.LayoutInstance, connector: Geomorph.Connector, roomId: number): null | number {
  const [a, b] = connector.roomIds;
  if (a === roomId) return b ?? roomAt(gm, connector.center, connector.entries[1]);
  if (b === roomId) return a ?? roomAt(gm, connector.center, connector.entries[0]);
  return null;
}

/** Which room holds `entry`, looked for a little further on from `from` than the entry itself */
function roomAt(gm: Geomorph.LayoutInstance, from: Geom.VectJson, entry: Geom.VectJson): null | number {
  const x = entry.x + (entry.x - from.x) * ENTRY_REACH_EXTRA;
  const y = entry.y + (entry.y - from.y) * ENTRY_REACH_EXTRA;
  // the polygons, not `findRoomIdContaining` — that reads a canvas and throws on a non-integer
  const roomId = gm.rooms.findIndex((room) => room.contains({ x, y }));
  return roomId === -1 ? null : roomId;
}

/** How long a room takes to fade in or out, in seconds */
const fadeSecs = 1;

const MAX_FADED_IN_ROOMS = 12;
/** How much further past a connector's entry to look for its room, relative to its own depth */
const ENTRY_REACH_EXTRA = 0.5;

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
  /** The FULLER of two slots, for what stands between two rooms: a wall, a door */
  fadeAtPair(slots: THREE.Node<"vec2">): THREE.Node<"float">;
  /** `color` with its alpha taken by `fade` */
  applyFadeRgba(color: THREE.Node<"vec4">, fade: THREE.Node<"float">): THREE.Node<"vec4">;
  /** Re-reads which rooms are in view and sends their fades off. Cheap, but not per frame */
  sync(w: WorldLike): void;
};

/** What this reads — a subset of `World`, so the service need not import it */
type WorldLike = {
  gms: Geomorph.LayoutInstance[];
  gmsData: DerivedGmsData;
  gmGraph: GmGraph;
  d: Record<string, Geomorph.DoorState>;
  player?: { key: string };
  e: { npcToRoom: Map<string, Geomorph.GmRoomId> };
  r3f?: null | { invalidate(): void };
};
