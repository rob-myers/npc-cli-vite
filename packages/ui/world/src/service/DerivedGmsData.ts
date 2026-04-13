import { geomorphKeys, type StarShipGeomorphKey } from "@npc-cli/media/starship-symbol";
import { geomService } from "@npc-cli/util";
import { drawPolygons } from "@npc-cli/util/service/canvas";
import { Poly } from "@npc-cli/util/geom/poly";
import { floorTextureDimension, gmFloorExtraScale, wallHeight, worldToSguScale } from "../const";
import { getContext2d } from "./tex-array";

const worldToCanvas = worldToSguScale * gmFloorExtraScale;

export default class DerivedGmsData {
  count = {
    door: 0,
    wall: 0,
    obstacles: 0,
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

    // lintels (2 quads per door):
    gmData.wallPolySegCounts.push(2 * gm.doors.length);
    // windows (upper/lower, may not be quads):
    gmData.wallPolySegCounts.push(2 * gm.windows.reduce((sum, x) => sum + x.poly.outline.length, 0));

    // 🚧 ...
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

    // room pick canvas: each room filled with rgb(roomId+1, 0, 0)
    if (!gmData.roomCanvas) {
      gmData.roomCanvas = getContext2d(`room-pick-${gm.key}`, { willReadFrequently: true });
    }
    const roomCt = gmData.roomCanvas;
    roomCt.canvas.width = floorTextureDimension;
    roomCt.canvas.height = floorTextureDimension;
    roomCt.resetTransform();
    roomCt.clearRect(0, 0, roomCt.canvas.width, roomCt.canvas.height);
    roomCt.setTransform(
      worldToCanvas, 0, 0, worldToCanvas,
      -gm.bounds.x * worldToCanvas, -gm.bounds.y * worldToCanvas,
    );
    for (const [roomId, room] of gm.rooms.entries()) {
      drawPolygons(roomCt, [room], { fillStyle: `rgb(${roomId + 1}, 0, 0)`, strokeStyle: null });
    }

    gmData.unseen = false;
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
  };
}
