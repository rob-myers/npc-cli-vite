import { warn } from "@npc-cli/util/legacy/generic";
import { Break, Fn, float, If, int, Loop, min, time, uniform, uniformArray, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import type DerivedGmsData from "./DerivedGmsData";
import { helper } from "./helper";
import { arrivedAt, morphNode, retarget } from "./morph";
import { alwaysShownSlot, broadWallSlotOf, slotOf, totalRoomSlots } from "./room-slots";

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
  /** `1` whilst the rooms in view are outlined over the finished frame — a debug option */
  outlines: THREE.UniformNode<"float", number>;
  /** The rooms in view, in the order their outlines are packed. Kept up to date whatever `enabled` says */
  rooms: Geomorph.GmRoomId[];
  /** How much of a thing in `slot` is shown, `1` being all of it — see `service/room-slots` */
  getVisiblity(slot: THREE.Node<"float">): THREE.Node<"float">;
  /** The FULLER of two slots, for what stands between two rooms: a wall, a door */
  fadeAtPair(slots: THREE.Node<"vec2">): THREE.Node<"float">;
  /** `color` with its alpha taken by `fade` */
  applyFadeRgba(color: THREE.Node<"vec4">, fade: THREE.Node<"float">): THREE.Node<"vec4">;
  /** How far `worldXZ` lies from the nearest edge of any room in view — the debug outline */
  distanceAt(worldXZ: THREE.Node<"vec2">): THREE.Node<"float">;
  /** Re-reads which rooms are in view and sends their fades off. Cheap, but not per frame */
  sync(w: WorldLike): void;
};

/** What this reads — a subset of `World`, so the service need not import it */
type WorldLike = {
  gms: Geomorph.LayoutInstance[];
  gmsData: DerivedGmsData;
  d: Record<string, Geomorph.DoorState>;
  player?: { key: string };
  e: { npcToRoom: Map<string, Geomorph.GmRoomId> };
  r3f?: null | { invalidate(): void };
};

/**
 * Which rooms the world is shown in: the ones the player's light reaches, as opposed to the circle
 * `service/post-processing` otherwise fades on. A circle knows nothing about the walls, so it cuts
 * across rooms; fading on rooms lands every edge of the fade where a wall already is.
 *
 * The fade itself is PER ROOM, not per fragment. Every instance in the world carries the slot of
 * the room it stands in as a static attribute — see `service/room-slots` — so a material reads one
 * entry of the small array here and is done. An earlier attempt walked the room polygons per
 * fragment in every material, and the cost of that is what sank it.
 */
export function createFadeRooms(enabledInitially = false): FadeRooms {
  /** One per room in the world, plus the two that stand for no room */
  const morphs = Array.from({ length: totalRoomSlots }, () => arrivedAt(1, 0));
  const morphValues = Array.from({ length: totalRoomSlots }, () => new THREE.Vector3(1, 1, 0));
  const morphArray = uniformArray<"vec3">(morphValues, "vec3");

  /** Per room in view: `x` where its outline's verts start, `y` how many */
  const infoValues = Array.from({ length: maxFadeRooms }, () => new THREE.Vector4());
  const infos = uniformArray<"vec4">(infoValues, "vec4");
  /** Every room's outline, one after another, in world XZ */
  const vertValues = Array.from({ length: maxFadeVerts }, () => new THREE.Vector2());
  const verts = uniformArray<"vec2">(vertValues, "vec2");
  const roomCount = uniform(0);
  const outlines = uniform(0);

  const rooms: Geomorph.GmRoomId[] = [];
  /** Whilst set, frames are asked for — see `keepFramesComing` */
  let framesUntilMs = 0;
  let framesRaf = 0;

  const distanceAtFn = Fn(([worldXZ]: [THREE.Node<"vec2">]) => {
    const nearest = float(farAway).toVar();

    // An `If` around the work, not a `mix` at the call site — a shader evaluates BOTH sides of a
    // `mix`, so every pixel would pay for this walk with the outlines off. Not an early `Return`
    // either: tsl emits a bare `return;`, which wgsl will not have in a function returning `f32`
    If(outlines.greaterThan(0.5), () => {
      Loop(maxFadeRooms, ({ i }: { i: THREE.Node<"int"> }) => {
        If(i.toFloat().greaterThanEqual(roomCount), () => {
          Break();
        });
        // `toVar` materialises these: a bare `infos.element(i)` re-reads `i` wherever it is used,
        // and tsl gives both loops the same index name, so the inner one would fetch another room
        const start = int(infos.element(i).x).toVar();
        const vertCount = int(infos.element(i).y).toVar();

        Loop(maxRoomVerts, ({ i: j }: { i: THREE.Node<"int"> }) => {
          If(j.greaterThanEqual(vertCount), () => {
            Break();
          });
          // to the nearest point ON the edge, so a corner measures to its vertex
          const a = verts.element(start.add(j));
          const edge = verts.element(start.add(j.add(1).mod(vertCount))).sub(a);
          const along = worldXZ.sub(a).dot(edge).div(edge.dot(edge).max(1e-6)).clamp(0, 1);
          nearest.assign(min(nearest, worldXZ.sub(a.add(edge.mul(along))).length()));
        });
      });
    });

    return nearest;
  });

  function fadeAt(slot: THREE.Node<"float">) {
    return morphNode(morphArray.element(slot.toInt()), fadeSecs);
  }

  return {
    uid: crypto.randomUUID(),
    enabled: enabledInitially === true,
    outlines,
    rooms,
    getVisiblity: fadeAt,

    fadeAtPair(slots) {
      return fadeAt(slots.x).max(fadeAt(slots.y));
    },

    applyFadeRgba(color, fade) {
      return vec4(color.rgb, color.a.mul(fade));
    },

    distanceAt(worldXZ) {
      return distanceAtFn(worldXZ) as THREE.Node<"float">;
    },

    sync(w) {
      // whatever `enabled` says, since the debug outlines are switched on separately
      const inView = roomsInView(w);
      rooms.length = 0;
      if (inView !== null) rooms.push(...inView);
      packOutlines(w);

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

      for (let slot = 0; slot < totalRoomSlots; slot++) {
        const wanted = showAll === true || slot === alwaysShownSlot || shown.has(slot) ? 1 : 0;
        retarget(morphs[slot], wanted, fadeSecs, now);
        morphValues[slot].set(morphs[slot].from, morphs[slot].to, morphs[slot].at);
      }

      keepFramesComing(w);
    },
  };

  function packOutlines(w: WorldLike) {
    let total = 0;
    let count = 0;
    for (const { gmId, roomId } of rooms) {
      const gm = w.gms[gmId];
      // only `outline`, so a room's holes are dropped rather than read as inside
      const outline = gm?.rooms[roomId]?.outline;
      if (outline === undefined || outline.length === 0) continue;

      // truncating would chop a RUN of vertices out, the outline then closing straight from the
      // last kept back to the first — which reads as a corner simply missing. So it is said
      if (outline.length > maxRoomVerts) {
        warn(`fade-rooms: room ${gmId}-${roomId} has ${outline.length} verts, over ${maxRoomVerts}`);
      }
      const vertCount = Math.min(outline.length, maxRoomVerts);
      if (total + vertCount > maxFadeVerts) {
        warn(`fade-rooms: over ${maxFadeVerts} verts in view; room ${gmId}-${roomId} is dropped`);
        continue;
      }

      infoValues[count].set(total, vertCount, 0, 0);
      for (let v = 0; v < vertCount; v++, total++) {
        // `gm.rooms` are in the layout's own space, as `wallSegs` are
        const at = gm.matrix.transformPoint({ x: outline[v].x, y: outline[v].y });
        vertValues[total].set(at.x, at.y); // `y` is world Z
      }
      count++;
    }
    roomCount.value = count;
  }

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
 * through THAT room's window into a third. Breadth-first, so the cap keeps the nearest rooms.
 *
 * `null` where there is no player to see from — which is not the same as an empty answer, and is
 * why this does not give one. See `sync`
 *
 * 🚧 hull doors join two GEOMORPHS, and are not followed here
 */
function roomsInView(w: WorldLike): null | Geomorph.GmRoomId[] {
  const at = w.player === undefined ? undefined : w.e.npcToRoom.get(w.player.key);
  const gm = at && w.gms[at.gmId];
  if (at === undefined || gm === undefined) return null;

  const joins = Object.values(w.d)
    .filter((door) => door.open === true && door.gmId === at.gmId)
    .map((door) => door.connector)
    .concat(gm.windows ?? []);

  const out = [at];
  const seen = new Set([at.grKey]);
  // `out` is both the answer and the queue — appending whilst walking it is what makes this
  // breadth-first, since a room's neighbours land after every room already found
  for (let i = 0; i < out.length && out.length < maxFadeRooms; i++) {
    for (const connector of joins) {
      const roomId = otherRoom(gm, connector, out[i].roomId);
      if (roomId === null) continue;
      const grKey = helper.getGmRoomKey(at.gmId, roomId);
      if (seen.has(grKey) === true) continue;
      seen.add(grKey);
      if (out.push({ gmId: at.gmId, roomId, grKey }) >= maxFadeRooms) break;
    }
  }

  return out;
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
  const x = entry.x + (entry.x - from.x) * entryReachOn;
  const y = entry.y + (entry.y - from.y) * entryReachOn;
  // the polygons, not `findRoomIdContaining` — that reads a canvas and throws on a non-integer
  const roomId = gm.rooms.findIndex((room) => room.contains({ x, y }));
  return roomId === -1 ? null : roomId;
}

/** How long a room takes to fade in or out, in seconds */
const fadeSecs = 1;

/** Caps on the outlines drawn at once, the vertices any one room contributes, and the total */
const maxFadeRooms = 12;
const maxRoomVerts = 64;
const maxFadeVerts = 640;
/** How much further past a connector's entry to look for its room, relative to its own depth */
const entryReachOn = 0.5;
/** Further than anything is from a room edge, which is what `distanceAt` says when there are none */
const farAway = 1e6;
