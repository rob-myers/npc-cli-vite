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

/** The slot a room has to itself, across the whole map */
export function slotOf(gmId: number, roomId: number): number {
  return gmId * MAX_ROOMS_PER_GEOMORPH + roomId;
}

/** The broad wall's slot, which may be adjacent to many rooms. */
export function broadWallSlotOf(gmId: number, broadWallId: number): number {
  return broadSlotBase + gmId * MAX_BROAD_WALLS_PER_GEOMORPH + broadWallId;
}

// A slot for every room, every broad wall, plus one always and one never
export const roomSlotCount = MAX_GEOMORPH_INSTANCES * MAX_ROOMS_PER_GEOMORPH;
export const broadSlotBase = roomSlotCount;
const broadSlotCount = MAX_GEOMORPH_INSTANCES * MAX_BROAD_WALLS_PER_GEOMORPH;
/** For geometry belonging to no room — a door instance nobody is using */
export const alwaysShownSlot = broadSlotBase + broadSlotCount;
/** For a fragment belonging to no room at all, which the texture here reads as a blank */
export const neverShownSlot = alwaysShownSlot + 1;
export const totalSlots = neverShownSlot + 1;

/**
 * Which room each part of the world belongs to, precomputed before fragment.
 *
 * One slot per room across the whole map, `gmId * maxRoomsPerGm + roomId`, which `fade-rooms` keys
 * its per-room fades by. Instanced geometry carries its slot as a static attribute.
 * The floor/ceiling are one instance per geomorph so we read from texture instead.
 *
 * The same drawing serves both: sampled in GPU and read in CPU o give walls/obstacles their slots.
 */
export function createRoomSlots(): RoomSlots {
  const tex = new TexArray({
    ctKey: "room-slots",
    numTextures: MAX_GEOMORPH_INSTANCES,
    width: slotTextureDimension,
    height: slotTextureDimension,
  });
  /**
   * Per gmId, the drawn RED channel and the bounds it was drawn from — both wanted by `roomAt`. Red
   * alone: the CPU asks about rooms and nothing else, and the other three would triple what is held
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

      for (const [gmId, gm] of gms.entries()) {
        if (gmId >= MAX_GEOMORPH_INSTANCES) break;
        if (gm.rooms.length > MAX_ROOMS_PER_GEOMORPH) {
          warn(`room-slots: ${gm.key} has too many rooms: ${gm.rooms.length} (max ${MAX_ROOMS_PER_GEOMORPH})`);
        }
        const broadWalls = gmsData.byKey[gm.key]?.broadWalls ?? [];
        if (broadWalls.length > MAX_BROAD_WALLS_PER_GEOMORPH) {
          warn(`room-slots: ${gm.key} has too many broad walls: ${broadWalls.length}`);
        }

        // ONE POLYGON AT A TIME, each thresholded on its own coverage — see `rasterise`
        const roomCodes: [Geom.Poly, number][] = [];
        // a doorway lies between two rooms and is covered by neither
        for (const connector of [...gm.doors, ...gm.windows]) {
          const roomId = connector.roomIds.find((x) => typeof x === "number");
          if (roomId !== undefined) roomCodes.push([connector.poly, roomId + 1]);
        }
        // rooms are outset by half non-hull-wall width
        for (const [roomId, room] of gm.rooms.entries()) {
          for (const grown of geomService.createOutset(room, roomOutset)) roomCodes.push([grown, roomId + 1]);
        }

        const broadCodes = broadWalls
          .slice(0, MAX_BROAD_WALLS_PER_GEOMORPH)
          .map(({ poly }, broadWallId): [Geom.Poly, number] => [poly, broadWallId + 1]);

        const red = rasterise(ct, gm, roomCodes);
        const broad = rasterise(ct, gm, broadCodes);
        const data = new Uint8Array(red.length * 4);
        for (let i = 0; i < red.length; i++) {
          data[i * 4] = red[i];
          data[i * 4 + 1] = broad[i];
          data[i * 4 + 2] = 0;
          data[i * 4 + 3] = 255;
        }

        tex.updateIndex(gmId, data);
        drawn[gmId] = { red, bounds: gm.bounds };
      }
    },

    roomAt(gmId, local) {
      return ownRoomAt(gmId, local.x, local.y);
    },

    roomOfSeg(gmId, u, v) {
      // A wall segment is an edge of a room's outline, an edge of a doorway, or part of the hull —
      // so has at most ONE room, the one whose outline it lies on, and the map is asked at the midpoint
      // of the segment itself. Nothing to decide and no probing either side: `roomOutset` gives each
      // room the half of the wall nearest its OWN face, so that face has the room beyond it and the
      // room's own collar within it, and the pixel under the midpoint reads as that room from either
      // direction. A face with no room past it — against a broad wall, or the void — reads as blank
      return ownRoomAt(gmId, (u.x + v.x) / 2, (u.y + v.y) / 2);
    },

    decodeUvVisibility(uvNode, gmIndex, opts) {
      // red carries `roomId + 1`, so a zero is nothing at all rather than room zero. Nearest
      // filtered: a `DataArrayTexture` is by default, and interpolating ids means nothing.
      // Sampled ONCE, both channels off the one texel
      const texel = texture(tex.tex, uvNode).depth(gmIndex);
      const code = texel.r.mul(255).round();
      const roomSlot = gmIndex.toFloat().mul(MAX_ROOMS_PER_GEOMORPH).add(code).sub(1);
      // what no room reaches — the rim of the geomorph, the far half of a hull wall — reads as a
      // blank, and takes `neverShownSlot` with it
      const slot = mix(float(neverShownSlot), roomSlot, step(0.5, code));
      if (opts?.heedBroadWalls !== true) return slot;

      // and green a broad wall's `id + 1`, whose slot stands for ALL the rooms it abuts
      const broadCode = texel.g.mul(255).round();
      const broadSlot = float(broadSlotBase)
        .add(gmIndex.toFloat().mul(MAX_BROAD_WALLS_PER_GEOMORPH))
        .add(broadCode)
        .sub(1);
      return mix(slot, broadSlot, step(0.5, broadCode));
    },
  };

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
 * Always a `vec2`: a CONNECTOR has two rooms and takes the fuller (`FadeRooms.fadeAtPair`).
 * Everything else has one, carries it twice, and reads `.x`
 */
export function ensureRoomSlots(geo: THREE.BufferGeometry, count: number) {
  const existing = geo.getAttribute("roomSlots") as undefined | THREE.InstancedBufferAttribute;
  if (existing !== undefined && existing.count >= count) return existing;
  const attr = new THREE.InstancedBufferAttribute(new Float32Array(count * 2).fill(alwaysShownSlot), 2);
  geo.setAttribute("roomSlots", attr);
  return attr;
}

/**
 * Paints each polygon's `code` into a byte map, ONE AT A TIME.
 *
 * Drawn together they would be antialiased against each OTHER: where two rooms meet, both fills are
 * opaque, so the canvas blends their two codes and the shared edge comes out as a third room
 * altogether — a one-texel line at every boundary, drawn whenever that third room happens to be in
 * view, and jagged besides, this map being far coarser than the textures it cuts. No margin can
 * reach it, because it lies ON the boundary rather than beside it.
 *
 * So each is rasterised alone against nothing and taken by its COVERAGE: a pixel is that polygon's
 * or it is not, and the only thing an edge can blend with is transparency. Only its own bounding
 * box is read back, so the whole set costs about one pass over the canvas rather than one each
 */
function rasterise(ct: CanvasRenderingContext2D, gm: Geomorph.LayoutInstance, items: [Geom.Poly, number][]) {
  const out = new Uint8Array(slotTextureDimension * slotTextureDimension);

  for (const [poly, code] of items) {
    const { x, y, width, height } = poly.rect;
    const x0 = Math.max(0, Math.floor((x - gm.bounds.x) * slotScale) - 1);
    const y0 = Math.max(0, Math.floor((y - gm.bounds.y) * slotScale) - 1);
    const x1 = Math.min(slotTextureDimension, Math.ceil((x + width - gm.bounds.x) * slotScale) + 1);
    const y1 = Math.min(slotTextureDimension, Math.ceil((y + height - gm.bounds.y) * slotScale) + 1);
    if (x1 <= x0 || y1 <= y0) continue;

    ct.resetTransform();
    ct.clearRect(x0, y0, x1 - x0, y1 - y0);
    ct.setTransform(slotScale, 0, 0, slotScale, -gm.bounds.x * slotScale, -gm.bounds.y * slotScale);
    // white, the colour being beside the point — it is the alpha that is read
    drawPolygons(ct, [poly], { fillStyle: "rgba(255, 255, 255, 1)", strokeStyle: null });

    const { data } = ct.getImageData(x0, y0, x1 - x0, y1 - y0, { colorSpace: "srgb" });
    for (let row = y0; row < y1; row++) {
      for (let col = x0; col < x1; col++) {
        const covered = data[((row - y0) * (x1 - x0) + (col - x0)) * 4 + 3] >= 128;
        if (covered === true) out[row * slotTextureDimension + col] = code;
      }
    }
  }

  return out;
}

/** The same dimensions and transform as `DerivedGmsData`'s room-hit canvas */
const slotTextureDimension = Math.round(floorTextureDimension * roomHitTextureScaleDown);
const slotScale = roomHitTextureScaleDown * worldToSguScale * gmFloorExtraScale;

/**
 * How far each room is grown, in metres: half a non-hull wall's thickness.
 *
 * Rooms are drawn as they are given, meeting nowhere — so the ground under every wall belongs to
 * nobody, and the ceiling, which is one lid over the lot, has no room to draw a wall's top by. Grown
 * by half a wall each room takes the near half of the walls around it, and the two halves of a wall
 * between two rooms go one to each. Half is the most that can be given away and still leave the
 * rooms DISJOINT, which is what keeps this a map of rooms: one room per pixel, one pixel per room,
 * and no boundary where a third id can appear.
 *
 * It is also what makes `roomOfSeg` a single lookup: a wall's face and the collar behind it read as
 * the same room, so the midpoint of that face names its room outright.
 *
 * A hull wall is 0.2m, so half of one stays blank — deliberately: what is drawn there is the rim of
 * the geomorph, which belongs to no room inside it
 */
const roomOutset = 0.05;

export type RoomSlots = {
  /** One layer per `gmId`: red carries `roomId + 1`, green a broad wall's `id + 1` */
  tex: TexArray;
  /** Draws and uploads if the map has changed. */
  ensure(gms: Geomorph.LayoutInstance[], gmsData: DerivedGmsData, gmsHash: number): void;
  /**
   * Which roomId covers `localPoint` in the geomorph local coordinates like `gm.rooms` and `wallSegs`,
   * or `null` otherwise. Reads the drawn pixels, so it sees the `roomOutset` below
   */
  roomAt(gmId: number, localPoint: Geom.VectJson): null | number;
  /** Whose wall a segment is, in the geomorph's own space — or `null` where it faces no room at all */
  roomOfSeg(gmId: number, u: Geom.VectJson, v: Geom.VectJson): null | number;
  /** The slot at `uvNode` of layer `gmIndex` — for floor and the ceiling (one instance per geomorph) */
  decodeUvVisibility(
    uvNode: THREE.Node<"vec2">,
    gmIndex: THREE.Node<"uint">,
    opts?: {
      /**
       * Broad wall's own slot take predence rather than what lies beneath —
       * a broad wall abuts many rooms and is shown whilst any of them is.
       */
      heedBroadWalls?: boolean;
    },
  ): THREE.Node<"float">;
};
