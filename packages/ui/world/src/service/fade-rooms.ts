import { Discard, Fn, float, positionLocal, uniform, uniformArray, vec3, vec4 } from "three/tsl";
import * as THREE from "three/webgpu";
import type { State as WorldType } from "../components/World";
import { helper } from "./helper";
import { arrivedAt, morphNode, retarget, settled } from "./morph";
import { alwaysShownSlot, broadWallSlotOf, slotOf, totalSlots } from "./room-slots";

/**
 * During fade mode this computes faded in/out rooms.
 *
 * Per-room fade rather then per-fragment. Each instance of an instancedMesh in the world carries the slot of
 * the room it stands in as a static attribute — so a material reads an small array entry and is done.
 */
export function createFadeRooms(initialMode: FadeRoomsMode = "qa"): FadeRooms {
  /**
   * The clock every fade here is drawn against. Ours, not tsl's, which advances by the wall time
   * between RENDERS — so a fade begun after an idle spell would be handed all of it on its first
   * frame and arrive already over
   */
  const clockValue = uniform(nowSecs());
  const clockNode = float(clockValue);

  // `1` in `"prod"` mode and `0` in the others. A morph rather than a plain uniform, so that
  // switching between the two is a fade of its own rather than a snap
  const prodMorph = arrivedAt(initialMode === "prod" ? 1 : 0, nowSecs());
  const prodValue = uniform(new THREE.Vector3(prodMorph.from, prodMorph.to, prodMorph.at));
  const prodAmount = morphNode(prodValue, MODE_FADE_SECS, clockNode);

  const morphs = Array.from({ length: totalSlots }, () => arrivedAt(1, nowSecs()));
  const morphValues = Array.from({ length: totalSlots }, () => new THREE.Vector3(1, 1, 0));
  const morphArray = uniformArray<"vec3">(morphValues, "vec3");

  const rooms: Geomorph.GmRoomId[] = [];
  /** Which slots `prod` has wiped away entirely — see `isWipedOut` */
  const wiped = new Set<number>();
  /**
   * The slots on their way OUT and not wiped yet, each by the clock time its fade lands on. The
   * only ones `syncWiped` has to look at, so it can run every frame — the rest are settled either
   * way. Outside `prod` nothing drains it, and switching INTO prod wipes the lot at once
   */
  const fadingOut = new Map<number, number>();
  /** `this.mode` as `sync` last saw it, for what runs between syncs — see `keepFramesComing` */
  let syncedMode = initialMode;
  /** Whilst set, frames are asked for — see `keepFramesComing` */
  let framesUntilMs = 0;
  let framesRaf = 0;

  function fadeAt(slot: THREE.Node<"float">) {
    return morphNode(morphArray.element(slot.toInt()), ROOM_FADE_SECS, clockNode);
  }

  return {
    uid: crypto.randomUUID(),
    mode: initialMode,
    snapNext: true,
    rooms,
    getVisiblity: fadeAt,
    prodNode: prodAmount,

    isArriving(slot) {
      // heading for shown and not there yet — the room part way in that an npc walks into
      const morph = morphs[slot];
      return morph !== undefined && morph.to === 1 && this.hasArrived(slot) === false;
    },

    hasArrived(slot) {
      const morph = morphs[slot];
      return morph !== undefined && morph.to === 1 && settled(morph, ROOM_FADE_SECS, nowSecs()) === true;
    },

    isWipedOut(slot) {
      return wiped.has(slot);
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
        // `prod` only: `dev` blacks a hidden room out but leaves it there to be picked
        Discard(objectPick.notEqual(0).and(fade.lessThan(0.5)).and(prodAmount.greaterThan(0.5)));
        return node;
      })();
    },

    sync(w) {
      const inView = roomsInView(w);

      rooms.length = 0;
      if (inView !== null) {
        rooms.push(...inView);
        if (w.view.litNpcsEnabled.value === 1) {
          for (const lit of w.e.litRooms.values()) rooms.push(...lit);
        }
        // and whatever was lit by hand, which nothing about the player decides — see `setRoomLit`
        for (const grKey of w.e.handLitRooms) rooms.push(helper.getGmRoomId(grKey));
      }

      const showAll = this.mode === "qa" || inView === null;
      const now = tick();
      syncedMode = this.mode;

      // A new map is arrived at rather than faded to
      const snap = this.snapNext;
      if (snap === true && inView !== null) this.snapNext = false;

      // `qa` shows everything anyway, so it keeps whichever answer it had — and coming back out of
      // it, the rooms are already as dark as the mode returned to wants them
      if (this.mode !== "qa") {
        const wanted = this.mode === "prod" ? 1 : 0;
        if (snap === true) Object.assign(prodMorph, arrivedAt(wanted, now));
        else retarget(prodMorph, wanted, MODE_FADE_SECS, now);
        prodValue.value.set(prodMorph.from, prodMorph.to, prodMorph.at);
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

      for (let slot = 0; slot < totalSlots; slot++) {
        const next = showAll === true || slot === alwaysShownSlot || shown.has(slot) ? 1 : 0;
        if (snap === true) Object.assign(morphs[slot], arrivedAt(next, now));
        else retarget(morphs[slot], next, ROOM_FADE_SECS, now);
        morphValues[slot].set(morphs[slot].from, morphs[slot].to, morphs[slot].at);

        // a room going out is wiped once its fade lands; coming back it is given back at once
        if (next === 0) {
          if (wiped.has(slot) === false) fadingOut.set(slot, snap === true ? now : morphs[slot].at + ROOM_FADE_SECS);
        } else {
          fadingOut.delete(slot);
          wiped.delete(slot);
        }
      }

      syncWiped(now);
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
    const frame = () => {
      const now = tick(); // moved on before the frame that reads it
      // a fade plays out over frames rather than syncs, and does so whilst the world is paused —
      // so the wipe lands here rather than waiting on a tick that may not come. Rooms first: an
      // npc changing room reads the answer this settles
      syncWiped(now);
      w.e?.syncNpcRoomSlots();
      // both drop the instances of whoever is wiped, so they are rewritten when that changes —
      // here rather than on the tick, since a fade plays out whilst the world is paused
      w.shadows?.onTick();
      w.rings?.onTick();
      w.r3f?.invalidate();
      framesRaf = performance.now() < framesUntilMs ? requestAnimationFrame(frame) : 0;
    };
    framesRaf = requestAnimationFrame(frame);
  }

  /**
   * Brings `wiped` up to the clock: rooms join it as their fades land, and leaving `prod` gives
   * every one of them back at once. Only `fadingOut` is walked — the rest are settled either way —
   * so this is cheap enough for every frame of a fade
   */
  function syncWiped(now: number) {
    // the wipe only begins once the mode itself has arrived — see `bodyFade` in `NPCs`
    const wiping = syncedMode === "prod" && prodMorph.to === 1 && settled(prodMorph, MODE_FADE_SECS, now);

    if (wiping === false) {
      wiped.clear();
      return;
    }

    for (const [slot, at] of fadingOut) {
      if (now < at) continue;
      fadingOut.delete(slot);
      wiped.add(slot);
    }
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
 *
 * The player's own room's windows are always seen through; any further off only where an
 * open door already reached declares a line of sight to it (tag `rel=sees:{name}`).
 *
 * Vouching works in one pass because the walk is breadth-first and a room's DOORS are connected
 * before its windows in `GmRoomGraph.fromGmGraph`, so a door has had its say before the window it
 * names is tested.
 *
 * `getReachableUpTo` keeps the node it stops on and takes none of its successors, so a shut door is
 * reached and not passed through. Nothing else stops it: the shut doors decide how far the light
 * gets, which is what being able to see amounts to, over a graph of a couple of hundred nodes.
 *
 * `null` where there is no player to see from — which is not the same as an empty answer, and is
 * why this does not give one. See `sync`
 */
function roomsInView(w: WorldType): null | Geomorph.GmRoomId[] {
  if (w.player === undefined) {
    return null;
  }

  const gmRoomId = w.e.npcToRoom.get(w.player.key);
  if (gmRoomId === undefined || w.gms[gmRoomId.gmId] === undefined) {
    return null;
  }

  /** Windows vouched for by an open door already reached — see `node.lineOfSight` */
  const vouched = new Set<Geomorph.SeesKey>();

  return w.gmRoomGraph
    .getReachableUpTo(gmRoomId.grKey, (node, depth) => {
      if (node.type === "door") {
        if (w.d[node.gdKey]?.open !== true) return true;
        // an open door we have reached vouches for whatever it says it can see
        for (const key of node.lineOfSight ?? []) vouched.add(key);
        return false;
      }
      // glass in the player's OWN room is seen through (`depth` 1 being its connectors); further off
      // only where a door said so, else one window onto a corridor lights the whole ship
      return node.type === "window" && depth > 1 && vouched.has(node.id) === false;
    })
    .flatMap((node) => (node.type === "room" ? helper.getGmRoomId(node.gmId, node.roomId) : []));
}

/**
 * How much of the world is shown, cycled by the fade button and bound to keys `1`, `2` and `3`:
 * - `prod` — only what the player can see. FOR NOW the same as `dev`
 * - `dev` — what they cannot see goes black and stays, so the world still reads as a floorplan
 * - `qa` — all of it, all the time, as a game master sees it
 */
export type FadeRoomsMode = "prod" | "dev" | "qa";

/** Which key selects which mode */
export const fadeRoomsModeByKey: Record<string, FadeRoomsMode> = {
  "1": "prod",
  "2": "dev",
  "3": "qa",
};

/** The next mode round, for the fade button: `1` to `2` to `3` and back */
export function nextFadeRoomsMode(mode: FadeRoomsMode): FadeRoomsMode {
  return mode === "prod" ? "dev" : mode === "dev" ? "qa" : "prod";
}

/** `mode` if it is one, else the default — stored settings are not to be trusted */
export function parseFadeRoomsMode(mode: unknown): FadeRoomsMode {
  return mode === "prod" || mode === "dev" || mode === "qa" ? mode : "qa";
}

/** How long the switch between `"prod"` and `"dev"` takes to play out, in seconds */
const MODE_FADE_SECS = 0.7;

/** The wall clock, in seconds */
function nowSecs() {
  return performance.now() / 1000;
}

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
  /**
   * Whilst set, the next `sync` that knows which rooms are in view ARRIVES at its answer instead of
   * fading to it. Set on map change, where there is nothing to fade from
   */
  snapNext: boolean;
  /** The rooms in view, whatever `mode` says — what the debug outlines are drawn for */
  rooms: Geomorph.GmRoomId[];
  /** How much of a thing in `slot` is shown, `1` being all of it — see `service/room-slots` */
  getVisiblity(slot: THREE.Node<"float">): THREE.Node<"float">;
  /** Whether `slot` is on its way IN and not there yet — the CPU-side answer, for what cannot read a node */
  isArriving(slot: number): boolean;
  /** Whether `slot` is shown and settled, with nothing of its fade left to play */
  hasArrived(slot: number): boolean;
  /**
   * Whether `prod` has wiped `slot` away entirely: the mode arrived, the room's fade fully out.
   * Nothing in it can be seen, so nothing in it need be DRAWN — see `syncNpcVisibility`
   */
  isWipedOut(slot: number): boolean;
  /**
   * `1` in `"prod"` mode and `0` in the others, easing between the two as the mode changes — for
   * what the two modes do differently. See the tints in `Floor` and `Obstacles`, which `prod`
   * takes all the way to black
   */
  prodNode: THREE.Node<"float">;
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
