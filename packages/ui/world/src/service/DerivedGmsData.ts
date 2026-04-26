import { geomorphKeys, type StarShipGeomorphKey } from "@npc-cli/media/starship-symbol";
import { geomService } from "@npc-cli/util";
import { Poly } from "@npc-cli/util/geom/poly";
import { drawPolygons } from "@npc-cli/util/service/canvas";
import { floorTextureDimension, gmFloorExtraScale, wallHeight, worldToSguScale } from "../const";
import { RoomGraph } from "./room-graph";
import { getContext2d } from "./tex-array";

const worldToCanvas = worldToSguScale * gmFloorExtraScale;

export default class DerivedGmsData {
  count = {
    door: 0,
    wall: 0,
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

  async computeGmKey(gm: Geomorph.Layout) {
    const gmData = this.byKey[gm.key];

    gmData.doorSegs = gm.doors.map(({ seg, meta }) => ({ seg, hull: meta.hull === true }));
    gmData.polyDecals = gm.unsorted.filter((x) => x.meta.poly === true);
    gmData.wallSegs = [
      ...gm.walls.flatMap((x) => x.lineSegs.map((seg) => ({ seg, meta: x.meta }))),
      // ...gm.doors.flatMap(connector => this.getLintelSegs(connector)),
      // ...gm.windows.flatMap(connector => this.getWindowSegs(connector)),
    ];

    gmData.wallPolyCount = gm.walls.length;

    gmData.wallPolySegCounts = gm.walls.map(
      ({ outline, holes }) => outline.length + holes.reduce((sum, hole) => sum + hole.length, 0),
    );

    // 🚧 remove lintels?
    // lintels (2 quads per door):
    gmData.wallPolySegCounts.push(2 * gm.doors.length);
    // windows (upper/lower, may not be quads):
    gmData.wallPolySegCounts.push(2 * gm.windows.reduce((sum, x) => sum + x.poly.outline.length, 0));

    const nonHullWallsTouchCeil = gm.walls.filter(
      (poly) =>
        poly.meta.hull !== true &&
        poly.meta.hollow !== true &&
        (poly.meta.h === undefined || poly.meta.y + poly.meta.h === wallHeight), // touches ceiling
    );
    gmData.tops = {
      broad: gm.walls.filter((x) => x.meta.broad === true),
      // hull: Poly.union(gm.walls.filter((x) => x.meta.hull).concat(gm.hullDoors.map((x) => x.computeThinPoly()))),
      hull: Poly.union(gm.walls.filter((x) => x.meta.hull)).flatMap((x) => geomService.createInset(x, 0.02)),
      // nonHull: Poly.union(nonHullWallsTouchCeil.concat(gm.doors.map((door) => door.computeThinPoly()))).flatMap((x) =>
      //   geomService.createInset(x, 0.02),
      // ),
      nonHull: Poly.union(nonHullWallsTouchCeil).flatMap((x) => geomService.createInset(x, 0.02)),
      window: gm.windows.map((window) => geomService.createInset(window.poly, 0.005)[0]),
    };

    // draw room/door pick canvas
    const roomCt = gmData.roomHitCt;
    roomCt.canvas.width = floorTextureDimension;
    roomCt.canvas.height = floorTextureDimension;
    roomCt.resetTransform();
    roomCt.clearRect(0, 0, roomCt.canvas.width, roomCt.canvas.height);
    roomCt.setTransform(worldToCanvas, 0, 0, worldToCanvas, -gm.bounds.x * worldToCanvas, -gm.bounds.y * worldToCanvas);
    for (const [doorId, door] of gm.doors.entries()) {
      drawPolygons(roomCt, [door.poly], { fillStyle: gmHitUtil.encodeDoor(doorId), strokeStyle: null });
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

    gmData.roomGraph = RoomGraph.from(gm, `${gm.key}: `);

    gmData.unseen = false;
  }

  /**
   * Lookup pixel in geomorph room hit canvas.
   */
  findRoomIdContaining(gm: Geomorph.Layout, localPoint: Geom.VectJson, includeDoors = true): null | number {
    const ct = this.byKey[gm.key].roomHitCt;
    const scale = worldToSguScale * gmHitUtil.extraScale;
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
    return null;
  }
}

if (import.meta.hot) {
  import.meta.hot.accept((newModule) => {
    if (newModule) {
      window.dispatchEvent(new CustomEvent("hmr:DerivedGmsData", { detail: newModule.default }));
    }
  });
}

function createEmptyGmData(gmKey: StarShipGeomorphKey): Geomorph.GmData {
  return {
    gmKey,
    doorSegs: [],
    unseen: true,
    wallSegs: [],
    wallPolyCount: 0,
    wallPolySegCounts: [],
    polyDecals: [],
    tops: { broad: [], hull: [], nonHull: [], window: [] },
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
  /** rgba encoding `(200, roomId, 0, 1)` */
  redForRoom: 200,

  encodeDoor(doorId: number) {
    return `rgba(${gmHitUtil.redForDoor}, 0, ${doorId}, 1)` as const;
  },
  encodeRoom(roomId: number) {
    return `rgba(${gmHitUtil.redForRoom}, ${roomId}, 0, 1)` as const;
  },
  decode([red, roomId, doorId, _alpha]: [number, number, number, number]) {
    if (red === gmHitUtil.redForDoor) {
      return { type: "door", doorId } as const;
    }
    if (red === gmHitUtil.redForRoom) {
      return { type: "room", roomId } as const;
    }
    return null;
  },
} as const;
