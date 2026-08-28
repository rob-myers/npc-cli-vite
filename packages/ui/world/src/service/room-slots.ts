import { geomService } from "@npc-cli/util/geom-service";
import { warn } from "@npc-cli/util/legacy/generic";
import { drawPolygons } from "@npc-cli/util/service/canvas";
import { float, mix, step, texture } from "three/tsl";
import * as THREE from "three/webgpu";
import {
  floorTextureDimension,
  gmFloorExtraScale,
  MAX_BROAD_WALLS_PER_GEOMORPH,
  MAX_GEOMORPH_INSTANCES,
  MAX_ROOMS_PER_GEOMORPH,
  roomHitTextureScaleDown,
  worldToSguScale,
} from "../const";
import type DerivedGmsData from "./DerivedGmsData";
import { getContext2d, TexArray } from "./tex-array";

export type RoomSlots = {
  /**
   * One layer per `gmId`: red carries `roomId + 1`, green a broad wall's `id + 1`, and blue marks
   * where a HULL wall stands — see `drawGm`, `drawBroadWalls` and `drawHullWalls`
   */
  tex: TexArray;
  /**
   * Draws and uploads, if the map has changed since it last did.
   */
  ensure(gms: Geomorph.LayoutInstance[], gmsData: DerivedGmsData, gmsHash: number): void;
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
   * was drawn this is `neverShownSlot` rather than some room's — and so is wherever a HULL wall
   * stands, whatever room lies beneath it: the hull is thicker than the rooms are grown by, so part
   * of its footprint belongs to no room and the art over it comes out as a line along the rim of the
   * geomorph. `neverShownSlot` is `1` whilst the fade is off, so this costs nothing there.
   *
   * Also supports broad walls.
   */
  decodeUvVisibility(uvNode: THREE.Node<"vec2">, gmIndex: THREE.Node<"uint">): THREE.Node<"float">;
};

/** The slot a room has to itself, across the whole map */
export function slotOf(gmId: number, roomId: number): number {
  return gmId * MAX_ROOMS_PER_GEOMORPH + roomId;
}

/**
 * The broad wall's slot, which may be adjacent to many rooms.
 */
export function broadWallSlotOf(gmId: number, broadWallId: number): number {
  return broadSlotBase + gmId * MAX_BROAD_WALLS_PER_GEOMORPH + broadWallId;
}

/** A slot for every room the world can hold, then every broad wall, then one always and one never */
export const roomSlotCount = MAX_GEOMORPH_INSTANCES * MAX_ROOMS_PER_GEOMORPH;
const broadSlotBase = roomSlotCount;
const broadSlotCount = MAX_GEOMORPH_INSTANCES * MAX_BROAD_WALLS_PER_GEOMORPH;
/** For geometry belonging to no room — a door instance nobody is using */
export const alwaysShownSlot = broadSlotBase + broadSlotCount;
/** For a fragment belonging to no room at all, which the texture here reads as a blank */
export const neverShownSlot = alwaysShownSlot + 1;
export const totalRoomSlots = neverShownSlot + 1;

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

    ensure(gms, gmsData, gmsHash) {
      if (gmsHash === drawnHash) return;
      drawnHash = gmsHash;
      drawn.length = 0;

      const opts = { willReadFrequently: true, width: slotTextureDimension, height: slotTextureDimension } as const;
      const ct = getContext2d("room-slots", opts);
      // Its OWN canvas rather than another pass over the first: canvas cannot write one channel,
      // and a fill would take the room with it — which the floor reads, and the floor under a wall
      // must still go with its room. The two are merged below instead
      const broadCt = getContext2d("room-slots-broad", opts);
      const hullCt = getContext2d("room-slots-hull", opts);

      for (const [gmId, gm] of gms.entries()) {
        if (gmId >= MAX_GEOMORPH_INSTANCES) break;
        if (gm.rooms.length > MAX_ROOMS_PER_GEOMORPH) {
          warn(`room-slots: ${gm.key} has too many rooms: ${gm.rooms.length} (max ${MAX_ROOMS_PER_GEOMORPH})`);
        }
        const broadWalls = gmsData.byKey[gm.key]?.broadWalls ?? [];
        if (broadWalls.length > MAX_BROAD_WALLS_PER_GEOMORPH) {
          warn(`room-slots: ${gm.key} has too many broad walls: ${broadWalls.length}`);
        }
        drawGm(ct, gm);
        drawBroadWalls(broadCt, gm, broadWalls);
        drawHullWalls(hullCt, gm);

        const { data } = ct.getImageData(0, 0, slotTextureDimension, slotTextureDimension, { colorSpace: "srgb" });
        const broad = broadCt.getImageData(0, 0, slotTextureDimension, slotTextureDimension, {
          colorSpace: "srgb",
        }).data;
        const hull = hullCt.getImageData(0, 0, slotTextureDimension, slotTextureDimension, {
          colorSpace: "srgb",
        }).data;

        const red = new Uint8Array(slotTextureDimension * slotTextureDimension);
        for (let i = 0; i < red.length; i++) {
          red[i] = data[i * 4];
          // by COVERAGE, not by the green itself: `getImageData` is unpremultiplied, so an edge
          // pixel carries the exact id at a partial alpha, and half-covered is where it stops
          data[i * 4 + 1] = broad[i * 4 + 3] >= 128 ? broad[i * 4 + 1] : 0;
          data[i * 4 + 2] = hull[i * 4 + 3] >= 128 ? 255 : 0;
        }

        tex.updateIndex(gmId, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
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
      // filtered — a `DataArrayTexture` is by default, and interpolating ids means nothing.
      // Sampled ONCE, both channels off the one texel
      const texel = texture(tex.tex, uvNode).depth(gmIndex);
      const code = texel.r.mul(255).round();
      const roomSlot = gmIndex.toFloat().mul(MAX_ROOMS_PER_GEOMORPH).add(code).sub(1);
      const slot = mix(float(neverShownSlot), roomSlot, step(0.5, code));

      // and green a broad wall's `id + 1`, whose slot stands for ALL the rooms it abuts
      const broadCode = texel.g.mul(255).round();
      const broadSlot = float(broadSlotBase)
        .add(gmIndex.toFloat().mul(MAX_BROAD_WALLS_PER_GEOMORPH))
        .add(broadCode)
        .sub(1);
      const withBroad = mix(slot, broadSlot, step(0.5, broadCode));

      // and blue marks the HULL, which is nobody's floor and nobody's lid — last, so it wins
      return mix(withBroad, float(neverShownSlot), step(0.5, texel.b));
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

/**
 * Which broad wall stands where, as `id + 1` in green — the ceiling reads it in place of the room
 * beneath, so a broad wall's lid survives whilst ANY of the rooms it abuts is shown.
 */
function drawBroadWalls(ct: CanvasRenderingContext2D, gm: Geomorph.LayoutInstance, broadWalls: BroadWall[]) {
  ct.resetTransform();
  ct.clearRect(0, 0, slotTextureDimension, slotTextureDimension);
  ct.setTransform(slotScale, 0, 0, slotScale, -gm.bounds.x * slotScale, -gm.bounds.y * slotScale);

  for (const [broadWallId, { poly }] of broadWalls.entries()) {
    if (broadWallId >= MAX_BROAD_WALLS_PER_GEOMORPH) break;
    drawPolygons(ct, [poly], { fillStyle: `rgba(0, ${broadWallId + 1}, 0, 1)`, strokeStyle: null });
  }
}

type BroadWall = Geomorph.GmData["broadWalls"][number];

/**
 * Where the HULL stands, in blue. The floor and the ceiling drop whatever they were going to draw
 * there: it belongs to no room, so growing the rooms out to reach it means guessing how thick the
 * wall happens to be — and guessing short leaves the strip that shows as a line along the rim.
 *
 * Grown a little, to take the stroke the art puts around its own edge with it
 */
function drawHullWalls(ct: CanvasRenderingContext2D, gm: Geomorph.LayoutInstance) {
  ct.resetTransform();
  ct.clearRect(0, 0, slotTextureDimension, slotTextureDimension);
  ct.setTransform(slotScale, 0, 0, slotScale, -gm.bounds.x * slotScale, -gm.bounds.y * slotScale);

  const hull = gm.walls.flatMap((x) => (x.meta.hull === true ? geomService.createOutset(x, hullMargin) : []));
  drawPolygons(ct, hull, { fillStyle: "rgba(0, 0, 255, 1)", strokeStyle: null });

  // and the DOORWAYS are cut back out of it. A hull door is a way through rather than a piece of
  // hull, and the floor and the ceiling have to go on drawing it — marked, the doorway would come
  // out as a gap in the very place the two geomorphs are joined
  ct.globalCompositeOperation = "destination-out";
  drawPolygons(
    ct,
    gm.hullDoors.map((x) => x.poly),
    { fillStyle: "rgba(0, 0, 0, 1)", strokeStyle: null },
  );
  ct.globalCompositeOperation = "source-over";
}

/** `rgba(roomId + 1, 0, 0, 1)` — a red of `0` meaning no room, so room zero is not mistaken for it. Green is `drawGm`'s always-shown flag */
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
/** How much wider than itself the hull is marked, in metres — enough to take the art's own stroke */
const hullMargin = 0.04;

/** How far either side of a wall segment `roomsBeside` looks, in metres, and in what steps */
const probeFrom = 0.08;
const probeTo = 0.5;
const probeStep = 0.03;
