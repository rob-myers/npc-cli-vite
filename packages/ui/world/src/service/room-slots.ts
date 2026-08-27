import { geomService } from "@npc-cli/util/geom-service";
import { warn } from "@npc-cli/util/legacy/generic";
import { drawPolygons } from "@npc-cli/util/service/canvas";
import { float, mix, step, texture } from "three/tsl";
import * as THREE from "three/webgpu";
import {
  floorTextureDimension,
  gmFloorExtraScale,
  MAX_GEOMORPH_INSTANCES,
  MAX_ROOMS_PER_GEOMORPH,
  roomHitTextureScaleDown,
  worldToSguScale,
} from "../const";
import { getContext2d, TexArray } from "./tex-array";

export type RoomSlots = {
  /** One layer per `gmId`, red carrying `roomId + 1` — see `drawGm` */
  tex: TexArray;
  /**
   * Draws and uploads, if the map has changed since it last did.
   */
  ensure(gms: Geomorph.LayoutInstance[], gmsHash: number): void;
  /**
   * Which room covers `local` — in the geomorph's OWN space, as `gm.rooms` and `wallSegs` are — or
   * `null` where nothing does. Reads the drawn pixels, so it sees the outset below
   */
  roomAt(gmId: number, local: Geom.VectJson): null | number;
  /**
   * The rooms either side of a wall segment, in the geomorph's own space. The near one first, then
   * the one across the wall — or the near one again, where the wall has a room on one side only
   */
  roomsBeside(gmId: number, u: Geom.VectJson, v: Geom.VectJson): [number, number] | null;
  /**
   * The slot at `uvNode` of layer `gmIndex` — how the floor and the ceiling ask, being one instance
   * per GEOMORPH and so unable to carry a room in an attribute like everything else. Where nothing
   * was drawn this is `neverShownSlot` rather than some room's
   */
  decodeUvVisibility(uvNode: THREE.Node<"vec2">, gmIndex: THREE.Node<"uint">): THREE.Node<"float">;
};

/** The slot a room has to itself, across the whole map */
export function slotOf(gmId: number, roomId: number): number {
  return gmId * MAX_ROOMS_PER_GEOMORPH + roomId;
}

/** A slot for every room the world can hold, then one always shown and one never */
export const roomSlotCount = MAX_GEOMORPH_INSTANCES * MAX_ROOMS_PER_GEOMORPH;
/** For geometry belonging to no room — the hull's outer skin, a door instance nobody is using */
export const alwaysShownSlot = roomSlotCount;
/** For a fragment belonging to no room at all, which the texture here reads as a blank */
export const neverShownSlot = roomSlotCount + 1;
export const totalRoomSlots = roomSlotCount + 2;

/**
 * Which room every part of the world belongs to, so nothing has to work it out per fragment.
 *
 * One slot per room across the whole map, `gmId * maxRoomsPerGm + roomId`, which `fade-rooms` keys
 * its per-room fades by. Instanced geometry carries its slot as a static attribute; the floor and
 * the ceiling are one instance per GEOMORPH and so cannot, and read it from the texture here.
 *
 * The same drawing serves both: as a texture those two sample, and as pixels the cpu reads to give
 * walls and obstacles their slots — one source of truth rather than two that can drift apart.
 */
export function createRoomSlots(): RoomSlots {
  const tex = new TexArray({
    ctKey: "room-slots",
    numTextures: MAX_GEOMORPH_INSTANCES,
    width: slotTextureDimension,
    height: slotTextureDimension,
  });
  /**
   * Per gmId, the drawn RED channel and the bounds it was drawn from — both wanted by `roomAt`.
   * Red alone: it is all that carries anything, and the other three would triple what is held for
   * nothing
   */
  const drawn: (undefined | { red: Uint8Array; bounds: Geom.RectJson })[] = [];
  /** What was last drawn, so repeated calls within one map cost nothing */
  let drawnHash = Number.NaN;

  return {
    tex,

    ensure(gms, gmsHash) {
      if (gmsHash === drawnHash) return;
      drawnHash = gmsHash;
      drawn.length = 0;

      const ct = getContext2d("room-slots", {
        willReadFrequently: true,
        width: slotTextureDimension,
        height: slotTextureDimension,
      });

      for (const [gmId, gm] of gms.entries()) {
        if (gmId >= MAX_GEOMORPH_INSTANCES) break;
        if (gm.rooms.length > MAX_ROOMS_PER_GEOMORPH) {
          warn(`room-slots: ${gm.key} has too many rooms: ${gm.rooms.length} (max ${MAX_ROOMS_PER_GEOMORPH})`);
        }
        drawGm(ct, gm);
        const { data } = ct.getImageData(0, 0, slotTextureDimension, slotTextureDimension, { colorSpace: "srgb" });
        tex.updateIndex(gmId, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));

        const red = new Uint8Array(slotTextureDimension * slotTextureDimension);
        for (let i = 0; i < red.length; i++) red[i] = data[i * 4];
        drawn[gmId] = { red, bounds: gm.bounds };
      }
    },

    roomAt(gmId, local) {
      return ownRoomAt(gmId, local.x, local.y);
    },

    roomsBeside(gmId, u, v) {
      const mx = (u.x + v.x) / 2;
      const my = (u.y + v.y) / 2;
      const dx = v.x - u.x;
      const dy = v.y - u.y;
      const len = Math.hypot(dx, dy) || 1;
      // a wall segment lies along the boundary, so its rooms are found to either side of it
      const nx = -dy / len;
      const ny = dx / len;
      const near = probe(gmId, mx, my, nx, ny, null);
      if (near === null) return null;
      // the far side is asked for a room OTHER than the near one, and walked outwards until it
      // finds one: the first step lands inside the wall itself, where the outset above has already
      // written whichever room happened to reach there — which would otherwise be the near one
      return [near, probe(gmId, mx, my, -nx, -ny, near) ?? near];
    },

    decodeUvVisibility(uvNode, gmIndex) {
      // red carries `roomId + 1`, so a zero is nothing at all rather than room zero. Nearest
      // filtered — a `DataArrayTexture` is by default, and interpolating room ids means nothing
      const code = texture(tex.tex, uvNode).depth(gmIndex).r.mul(255).round();
      const roomSlot = gmIndex.toFloat().mul(MAX_ROOMS_PER_GEOMORPH).add(code).sub(1);
      return mix(float(neverShownSlot), roomSlot, step(0.5, code));
    },
  };

  /** Walks out along `(nx, ny)` for the nearest room that is not `avoid` */
  function probe(gmId: number, x: number, y: number, nx: number, ny: number, avoid: null | number) {
    for (let d = probeFrom; d <= probeTo; d += probeStep) {
      const roomId = ownRoomAt(gmId, x + nx * d, y + ny * d);
      if (roomId !== null && roomId !== avoid) return roomId;
    }
    return null;
  }

  function ownRoomAt(gmId: number, x: number, y: number) {
    const at = drawn[gmId];
    if (at === undefined) return null;
    const px = Math.round((x - at.bounds.x) * slotScale);
    const py = Math.round((y - at.bounds.y) * slotScale);
    if (px < 0 || py < 0 || px >= slotTextureDimension || py >= slotTextureDimension) return null;
    // red carries `roomId + 1`, so a zero is nothing at all rather than room zero
    const code = at.red[py * slotTextureDimension + px];
    return code === 0 ? null : code - 1;
  }
}

/**
 * Gives `geo` the per-instance `roomSlots` it needs, sized for `count` and starting out shown —
 * an instance nobody has got to yet must not blink out before it is told where it stands.
 *
 * Always a `vec2`, whatever the mesh: what stands between two rooms carries both and takes the
 * fuller (`FadeRooms.fadeAtPair`), and what stands in one carries it twice and reads `.x`
 */
export function ensureRoomSlots(geo: THREE.BufferGeometry, count: number) {
  const existing = geo.getAttribute("roomSlots") as undefined | THREE.InstancedBufferAttribute;
  if (existing !== undefined && existing.count >= count) return existing;
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(count * 2).fill(alwaysShownSlot), 2);
  geo.setAttribute("roomSlots", attr);
  return attr;
}

function drawGm(ct: CanvasRenderingContext2D, gm: Geomorph.LayoutInstance) {
  ct.resetTransform();
  ct.clearRect(0, 0, slotTextureDimension, slotTextureDimension);
  ct.setTransform(slotScale, 0, 0, slotScale, -gm.bounds.x * slotScale, -gm.bounds.y * slotScale);

  // Connectors first, as a floor under the rest: a doorway lies BETWEEN two rooms and is covered by
  // neither, so it would read as nothing at all. Either of its rooms will do — a doorway's whole
  // purpose is that the two are shown together
  for (const connector of [...gm.doors, ...gm.windows]) {
    const roomId = connector.roomIds.find((x) => typeof x === "number");
    if (roomId === undefined) continue;
    drawPolygons(ct, [connector.poly], { fillStyle: encodeRoom(roomId), strokeStyle: null });
  }

  // then each room OUTSET, so the strip of floor a wall stands on belongs to the room the wall
  // encloses rather than to nothing — and so a wall's own midpoint lands in a room when the cpu
  // asks. Where two rooms' outsets meet inside a wall either answer is right, so the later wins
  for (const [roomId, room] of gm.rooms.entries()) {
    drawPolygons(ct, geomService.createOutset(room, roomOutset), { fillStyle: encodeRoom(roomId), strokeStyle: null });
  }

  // and each room exactly, over its own outset, so no neighbour's overspill reaches inside it
  for (const [roomId, room] of gm.rooms.entries()) {
    drawPolygons(ct, [room], { fillStyle: encodeRoom(roomId), strokeStyle: null });
  }
}

/** `rgba(roomId + 1, 0, 0, 1)` — a red of `0` meaning no room, so room zero is not mistaken for it */
function encodeRoom(roomId: number) {
  return `rgba(${roomId + 1}, 0, 0, 1)` as const;
}

/** The same dimensions and transform as `DerivedGmsData`'s room-hit canvas */
const slotTextureDimension = Math.round(floorTextureDimension * roomHitTextureScaleDown);
const slotScale = roomHitTextureScaleDown * worldToSguScale * gmFloorExtraScale;
/**
 * How far each room is grown before it is drawn, in metres — about half a wall, so a wall belongs
 * to the room it encloses rather than to nothing
 */
const roomOutset = 0.16;

/** How far either side of a wall segment `roomsBeside` looks, in metres, and in what steps */
const probeFrom = 0.02;
const probeTo = 0.5;
const probeStep = 0.03;
