import { geomorphKeys, type StarShipGeomorphKey } from "@npc-cli/media/starship-symbol";

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
    // this.seenGmKeys.push(gm.key);

    gmData.doorSegs = gm.doors.map(({ seg }) => seg);
    // gmData.polyDecals = gm.unsorted.filter(x => x.meta.poly === true);
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

    gmData.unseen = false;
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
  };
}
