import { geomorphKeys, getGeomorphNumber, type StarShipGeomorphKey } from "@npc-cli/media/starship-symbol";
import { isPlaygroundSymbolKey } from "@npc-cli/ui__map-edit/editor.schema";
import { Poly } from "@npc-cli/util/geom/poly";
import { geomService } from "@npc-cli/util/geom-service";
import { entries } from "@npc-cli/util/legacy/generic";
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
/** How far outside a broad wall's edge to look for a room, in metres — see `roomsTouching` */
const broadWallProbe = 0.05;

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

  /** Excludes playgrounds e.g. "g-301--bridge", "g-301--playground" share numeric identifier 301 */
  byNum = Object.fromEntries(
    entries(this.byKey).flatMap(([gmKey, gmData]) =>
      isPlaygroundSymbolKey(gmKey) ? [] : [[getGeomorphNumber(gmKey), gmData]],
    ),
  );

  /** Geomorph key to 1st geomorph instance. Only defined for `seenGmKeys` */
  gmKeyToFirst = {} as Record<StarShipGeomorphKey, Geomorph.LayoutInstance>;

  computeRoot(gms: Geomorph.LayoutInstance[]) {
    this.count = {
      door: gms.reduce((sum, { key }) => sum + this.byKey[key].doorSegs.length, 0),
      wall: gms.reduce((sum, { key }) => sum + this.byKey[key].wallSegs.length, 0),
      window: gms.reduce((sum, { key }) => sum + this.byKey[key].windowSegs.length, 0),
      obstacles: gms.reduce((sum, { obstacles }) => sum + obstacles.length, 0),
      obstacleSkirtEdges: gms.reduce(
        (sum, { obstacles }) => sum + obstacles.reduce((s, o) => s + o.origPoly.outline.length, 0),
        0,
      ),
      wallPolySegs: gms.map(({ key: gmKey }) =>
        this.byKey[gmKey].wallPolySegCounts.reduce((sum, count) => sum + count, 0),
      ),
    };

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

    const broadWallIdByWallId: number[] = [];
    gmData.broadWalls = [];
    gm.walls.forEach((poly, wallId) => {
      if (poly.meta.broad !== true) return;
      broadWallIdByWallId[wallId] = gmData.broadWalls.length;
      gmData.broadWalls.push({ poly, roomIds: [] });
    });

    gmData.wallSegs = gm.walls.flatMap((x, wallId) =>
      x.lineSegs.map((seg) => ({ seg, meta: x.meta, broadWallId: broadWallIdByWallId[wallId] ?? null })),
    );

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
      broad: gm.walls.filter((x) => x.meta.broad === true).flatMap((x) => geomService.createInset(x, 0.02)),
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

    for (const broadWall of gmData.broadWalls) {
      broadWall.roomIds = this.roomsTouching(gm, broadWall.poly);
    }

    gmData.roomGraph = RoomGraph.from(gm, `${gm.key}: `);

    gmData.unseen = false;
  }

  /**
   * Which rooms `poly` abuts, probed just outside each of its edges. A broad wall can touch many —
   * it is a piece of the ship's structure, not a partition between one room and the next
   */
  roomsTouching(gm: Geomorph.Layout, poly: Geom.Poly): number[] {
    const roomIds = new Set<number>();
    for (const [u, v] of poly.lineSegs) {
      const dx = v.x - u.x;
      const dy = v.y - u.y;
      const len = Math.hypot(dx, dy);
      if (len === 0) continue; // else the probe below is NaN, which the canvas lookup throws on
      const nx = (-dy / len) * broadWallProbe;
      const ny = (dx / len) * broadWallProbe;
      const mx = (u.x + v.x) / 2;
      const my = (u.y + v.y) / 2;
      // both sides, the winding not being something to rely on
      for (const sign of [1, -1]) {
        const roomId = this.findRoomIdContaining(gm, { x: mx + nx * sign, y: my + ny * sign });
        if (roomId !== null) roomIds.add(roomId);
      }
    }
    return Array.from(roomIds);
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
    broadWalls: [],
    doorSegs: [],
    unseen: true,
    wallSegs: [],
    wallPolyCount: 0,
    wallPolySegCounts: [],
    windowSegs: [],
    polyDecals: [],
    tops: { broad: [], hullDoor: [], hullWall: [], nonHullDoor: [], nonHullWall: [], window: [] },
    roomHitCt: getContext2d(`room-pick-${gmKey}`, { willReadFrequently: true }),
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
