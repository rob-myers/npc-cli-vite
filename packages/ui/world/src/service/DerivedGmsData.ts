import { geomorphKeys, type StarShipGeomorphKey } from "@npc-cli/media/starship-symbol";
import { Poly } from "@npc-cli/util/geom/poly";
import { geomService } from "@npc-cli/util/geom-service";
import { drawPolygons } from "@npc-cli/util/service/canvas";
import {
  floorTextureDimension,
  gmFloorExtraScale,
  roomHitTextureScaleDown,
  wallHeight,
  worldToSguScale,
} from "../const";
import { RoomGraph } from "./room-graph";
import { getContext2d } from "./tex-array";

const worldToCanvas = worldToSguScale * gmFloorExtraScale;

/**
 * Editing this file triggers World query HMR, which instantiates latest DerivedGmsData.
 */
export default class DerivedGmsData {
  count = {
    door: 0,
    wall: 0,
    window: 0,
    obstacles: 0,
    obstacleSkirtEdges: 0,
    wallPolySegs: [] as number[],
  };

  byKey = Object.fromEntries(geomorphKeys.map((gmKey) => [gmKey, createEmptyGmData(gmKey)])) as Record<
    StarShipGeomorphKey,
    Geomorph.GmData
  >;

  /** Geomorph key to 1st geomorph instance. Only defined for `seenGmKeys` */
  gmKeyToFirst = {} as Record<StarShipGeomorphKey, Geomorph.LayoutInstance>;

  computeRoot(gms: Geomorph.LayoutInstance[]) {
    this.count.door = gms.reduce((sum, { key }) => sum + this.byKey[key].doorSegs.length, 0);
    this.count.wall = gms.reduce((sum, { key }) => sum + this.byKey[key].wallSegs.length, 0);
    this.count.window = gms.reduce((sum, { key }) => sum + this.byKey[key].windowSegs.length, 0);
    this.count.obstacles = gms.reduce((sum, { obstacles }) => sum + obstacles.length, 0);
    this.count.obstacleSkirtEdges = gms.reduce(
      (sum, { obstacles }) => sum + obstacles.reduce((s, o) => s + o.origPoly.outline.length, 0),
      0,
    );
    this.count.wallPolySegs = gms.map(({ key: gmKey }) =>
      this.byKey[gmKey].wallPolySegCounts.reduce((sum, count) => sum + count, 0),
    );

    this.gmKeyToFirst = gms.reduce(
      (agg, gm) => ((agg[gm.key] ??= gm), agg),
      {} as Record<StarShipGeomorphKey, Geomorph.LayoutInstance>,
    );
  }

  computeGmKey(gm: Geomorph.Layout) {
    const gmData = this.byKey[gm.key];

    gmData.doorSegs = gm.doors.map(({ seg, meta }) => ({ seg, hull: meta.hull === true }));
    /**
     * 🔔 some windows are complex curved polygons, e.g.
     * 301: hull bridge window, 303: inner engineering window.
     * Inside `w.gmRoomGraph` they're modelled as a single segment.
     */
    gmData.windowSegs = gm.windows.flatMap(({ poly }) => poly.lineSegs.map((seg) => ({ seg })));
    gmData.polyDecals = gm.unsorted.filter((x) => x.meta.poly === true);
    gmData.wallSegs = gm.walls.flatMap((x) => x.lineSegs.map((seg) => ({ seg, meta: x.meta })));

    gmData.wallPolyCount = gm.walls.length;

    gmData.wallPolySegCounts = gm.walls.map(
      ({ outline, holes }) => outline.length + holes.reduce((sum, hole) => sum + hole.length, 0),
    );

    // 🚧 remove lintels
    // lintels (2 quads per door):
    gmData.wallPolySegCounts.push(2 * gm.doors.length);
    // windows (upper/lower, may not be quads):
    gmData.wallPolySegCounts.push(2 * gm.windows.reduce((sum, x) => sum + x.poly.outline.length, 0));

    const nonHullWallsTouchCeil = gm.walls.filter(
      (poly) =>
        poly.meta.hull !== true &&
        poly.meta.hollow !== true &&
        poly.meta.broad !== true &&
        (poly.meta.h === undefined || poly.meta.y + poly.meta.h === wallHeight), // touches ceiling
    );
    gmData.tops = {
      broad: gm.walls.filter((x) => x.meta.broad === true).flatMap((x) => geomService.createInset(x, 0.05)),
      nonHullDoor: gm.doors.flatMap((door) => (door.meta.hull === true ? [] : door.computeThinPoly(0.05))),
      hullDoor: gm.doors.flatMap((door) => (door.meta.hull === true ? door.computeThinPoly(0.15) : [])),
      hullWall: Poly.union(gm.walls.filter((x) => x.meta.hull)).flatMap((x) => geomService.createInset(x, 0.02)),
      // 🔔 must union after inset e.g. due to broad walls intersecting with others
      nonHullWall: Poly.union(nonHullWallsTouchCeil.flatMap((x) => geomService.createInset(x, 0.02))),
      window: gm.windows.map((window) => geomService.createInset(window.poly, 0.005)[0]),
    };

    // draw room/door pick canvas
    // 🔔 lower resolution than floor texture
    const roomCt = gmData.roomHitCt;
    roomCt.canvas.width = floorTextureDimension * roomHitTextureScaleDown;
    roomCt.canvas.height = floorTextureDimension * roomHitTextureScaleDown;
    roomCt.resetTransform();
    roomCt.clearRect(0, 0, roomCt.canvas.width, roomCt.canvas.height);

    const scale = roomHitTextureScaleDown * worldToCanvas;
    roomCt.setTransform(scale, 0, 0, scale, -gm.bounds.x * scale, -gm.bounds.y * scale);

    for (const [doorId, door] of gm.doors.entries()) {
      drawPolygons(roomCt, [door.poly], { fillStyle: gmHitUtil.encodeDoor(doorId), strokeStyle: null });
    }
    for (const [windowId, window] of gm.windows.entries()) {
      drawPolygons(roomCt, [window.poly], { fillStyle: gmHitUtil.encodeWindow(windowId), strokeStyle: null });
    }
    for (const [roomId, room] of gm.rooms.entries()) {
      drawPolygons(roomCt, [room], { fillStyle: gmHitUtil.encodeRoom(roomId), strokeStyle: null });
    }

    // populate connectors with adjacent roomIds
    for (const connector of gm.doors) {
      connector.roomIds = connector.entries.map((localPoint) => this.findRoomIdContaining(gm, localPoint)) as [
        number | null,
        number | null,
      ];
    }
    for (const connector of gm.windows) {
      connector.roomIds = connector.entries.map((localPoint) => this.findRoomIdContaining(gm, localPoint)) as [
        number | null,
        number | null,
      ];
    }

    // room-dimmer mask: R = roomId+1 (0 = not-a-room), G always 255 wherever R is set — no fade,
    // hard binary per room. Each room's territory is its own outset shape unioned with adjacent
    // doorways, so a doorway between two rooms is unambiguously owned by (at least) one of them —
    // if either is dimmed, the doorway itself reads as fully dark too, instead of a bright gap.
    // (A doorway pixel can only belong to one room's id, so whichever of its two rooms is later in
    // `gm.rooms` wins the overlap — harmless, just an arbitrary tie-break.)
    //
    // the final RGBA buffer is assembled by hand (via `dimData`/`putImageData`), never by
    // `drawPolygons` + `getImageData` straight onto `dimCt`: canvas anti-aliases polygon edges,
    // and at partial-coverage edge pixels the browser stores a premultiplied-alpha color then
    // un-premultiplies it back on `getImageData` — for low R values (small roomId+1) at low
    // coverage this rounds to a completely different integer, corrupting the decoded roomId right
    // at the boundary (visible as an antialiasing-looking fringe/flicker at every room edge). Each
    // room is instead drawn alone, in white, onto a scratch canvas and its coverage is thresholded
    // (>=128 alpha) before writing the *exact* intended color into the output buffer — so every
    // written pixel is either fully in or fully out, no blended/corrupted values ever reach the texture.
    const dimCt = gmData.dimMaskCt;
    const dimW = roomCt.canvas.width;
    const dimH = roomCt.canvas.height;
    dimCt.canvas.width = dimW;
    dimCt.canvas.height = dimH;
    dimCt.resetTransform();
    dimCt.clearRect(0, 0, dimW, dimH);

    const scratchCt = gmData.dimMaskScratchCt;
    scratchCt.canvas.width = dimW;
    scratchCt.canvas.height = dimH;

    const dimData = new Uint8ClampedArray(dimW * dimH * 4);

    for (const [roomId, room] of gm.rooms.entries()) {
      const doorPolys = gm.doors.filter((d) => d.roomIds.includes(roomId)).map((d) => d.poly);
      const territory = Poly.union([room.clone(), ...doorPolys]);

      scratchCt.resetTransform();
      scratchCt.clearRect(0, 0, dimW, dimH);
      scratchCt.setTransform(scale, 0, 0, scale, -gm.bounds.x * scale, -gm.bounds.y * scale);
      // stroke on top of the fill, same solid color: a plain fill leaves a ring of partial-coverage
      // (anti-aliased) pixels right at the path — the stroke repaints that ring at full coverage,
      // pushing the boundary to a cleaner, more consistent edge before thresholding below.
      drawPolygons(scratchCt, territory, { fillStyle: "#fff", strokeStyle: "#fff", lineWidth: 2 / scale });

      const { data: coverage } = scratchCt.getImageData(0, 0, dimW, dimH);
      for (let i = 0; i < coverage.length; i += 4) {
        if (coverage[i + 3] >= 128) {
          dimData[i] = roomId + 1;
          dimData[i + 1] = 255;
          dimData[i + 3] = 255;
        }
      }
    }

    dimCt.putImageData(new ImageData(dimData, dimW, dimH), 0, 0);

    gmData.roomGraph = RoomGraph.from(gm, `${gm.key}: `);

    gmData.unseen = false;
  }

  /**
   * Lookup pixel in geomorph room hit canvas.
   */
  findRoomIdContaining(gm: Geomorph.Layout, localPoint: Geom.VectJson, includeDoors = true): null | number {
    const ct = this.byKey[gm.key].roomHitCt;

    const scale = roomHitTextureScaleDown * worldToCanvas;
    const { data: rgba } = ct.getImageData(
      // transform to canvas coords
      (localPoint.x - gm.bounds.x) * scale,
      (localPoint.y - gm.bounds.y) * scale,
      1,
      1,
      { colorSpace: "srgb" },
    );

    // console.log({ gmKey: gm.key, localPoint, rgba: Array.from(rgba) });
    const decoded = gmHitUtil.decode(Array.from(rgba) as [number, number, number, number]);

    if (decoded === null) {
      return null;
    }

    if (decoded.type === "room") {
      return decoded.roomId;
    }

    if (decoded.type === "door") {
      if (includeDoors) {
        // choose 1st roomId if exists
        return gm.doors[decoded.doorId].roomIds.find((x) => typeof x === "number") ?? null;
      }
    }
    if (decoded.type === "window") {
      if (includeDoors) {
        // choose 1st roomId if exists — same flag as doors, since a window is also just a connector
        return gm.windows[decoded.windowId]?.roomIds.find((x) => typeof x === "number") ?? null;
      }
    }
    return null;
  }
}

function createEmptyGmData(gmKey: StarShipGeomorphKey): Geomorph.GmData {
  return {
    gmKey,
    doorSegs: [],
    unseen: true,
    wallSegs: [],
    wallPolyCount: 0,
    wallPolySegCounts: [],
    windowSegs: [],
    polyDecals: [],
    tops: { broad: [], hullDoor: [], hullWall: [], nonHullDoor: [], nonHullWall: [], window: [] },
    roomHitCt: getContext2d(`room-pick-${gmKey}`, { willReadFrequently: true }),
    dimMaskCt: getContext2d(`room-dim-mask-${gmKey}`, { willReadFrequently: true }),
    dimMaskScratchCt: getContext2d(`room-dim-mask-scratch-${gmKey}`, { willReadFrequently: true }),
    roomGraph: new RoomGraph(),
  };
}

const gmHitUtil = {
  /** Smaller value like `1.5` breaks "wall in room" e.g. 102 lab */
  extraScale: 2,

  // Fix alpha as `1` otherwise get pre-multiplied values.
  /** rgba encoding `(100, 0, doorId, 1)` */
  redForDoor: 100,
  /** rgba encoding `(150, 0, windowId, 1)` */
  redForWindow: 150,
  /** rgba encoding `(200, roomId, 0, 1)` */
  redForRoom: 200,

  encodeDoor(doorId: number) {
    return `rgba(${gmHitUtil.redForDoor}, 0, ${doorId}, 1)` as const;
  },
  encodeWindow(windowId: number) {
    return `rgba(${gmHitUtil.redForWindow}, 0, ${windowId}, 1)` as const;
  },
  encodeRoom(roomId: number) {
    return `rgba(${gmHitUtil.redForRoom}, ${roomId}, 0, 1)` as const;
  },
  decode([red, roomId, id, _alpha]: [number, number, number, number]) {
    if (red === gmHitUtil.redForDoor) {
      return { type: "door", doorId: id } as const;
    }
    if (red === gmHitUtil.redForWindow) {
      return { type: "window", windowId: id } as const;
    }
    if (red === gmHitUtil.redForRoom) {
      return { type: "room", roomId } as const;
    }
    return null;
  },
} as const;

1;
