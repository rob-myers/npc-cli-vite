import { Vector3 } from "three";

export const helper = {
  /**
   * Usage:
   * - `getGmDoorId(gdKey)`
   * - `getGmDoorId(gmId, doorId)`
   */
  getGmDoorId(...input: [Geomorph.GmDoorKey] | [number, number]): Geomorph.GmDoorId {
    if (typeof input[0] === "string") {
      const [, gStr, dStr] = input[0].split(/[gd]/);
      return { gdKey: input[0], gmId: Number(gStr), doorId: Number(dStr) };
    } else {
      return { gdKey: helper.getGmDoorKey(input[0], input[1]), gmId: input[0], doorId: input[1] };
    }
  },

  getGmDoorKey(gmId: number, doorId: number): Geomorph.GmDoorKey {
    return `g${gmId}d${doorId}`;
  },

  getGmWindowKey(gmId: number, windowId: number): Geomorph.GmWindowKey {
    return `g${gmId}w${windowId}`;
  },

  getGmRoomKey(gmId: number, roomId: number): Geomorph.GmRoomKey {
    return `g${gmId}r${roomId}`;
  },

  getGmRoomId(...input: [Geomorph.GmRoomKey] | [number, number]): Geomorph.GmRoomId {
    if (typeof input[0] === "string") {
      const [, gStr, rStr] = input[0].split(/[gr]/);
      return { grKey: input[0], gmId: Number(gStr), roomId: Number(rStr) };
    } else {
      return { grKey: helper.getGmRoomKey(input[0], input[1]), gmId: input[0], roomId: input[1] };
    }
  },

  groundPointToTuple(point: JshCli.GroundPoint): [number, number, number] {
    return [point.x, 0, point.y];
  },

  groundPointToVector3(point: JshCli.GroundPoint) {
    return new Vector3(point.x, 0, point.y);
  },

  isGmDoorKey(input: any): input is Geomorph.GmDoorKey {
    return !!input && typeof input === "string" && gdKeyRegex.test(input);
  },

  /**
   * 🔔 carefully chosen to be compatible
   * - assets.json decor meta has { gmId: -1, roomId: -1, grKey: "g-1r-1" }
   * - on createLayoutInstance gmId is provided
   */
  isGmRoomId(input: any): input is Geomorph.GmRoomId {
    return !!input && typeof input.grKey === "string" && input.roomId >= 0;
  },

  isPointAnyFormat(input: any): input is JshCli.PointAnyFormat {
    return !!input && Array.isArray(input)
      ? input.length >= 2 && input.every(Number.isFinite)
      : helper.isVectJson(input); // could test z numeric when exists
  },

  isVectJson(input: any): input is Geom.VectJson {
    return !!input && typeof input.x === "number" && typeof input.y === "number";
  },

  parse3dHeight(input: JshCli.PointAnyFormat): number | undefined {
    if ("z" in input) {
      return input.y;
    }
    if (Array.isArray(input)) {
      return input.length === 3 ? input[1] : undefined;
    }
    return undefined;
  },

  /**
   * Preserves meta.
   */
  parseGroundPoint(input: MaybeMeta<JshCli.PointAnyFormat>): MaybeMeta<JshCli.GroundPoint> {
    if (Array.isArray(input)) {
      return input.length === 3 ? { x: input[0], y: input[2] } : { x: input[0], y: input[1] };
    }
    const output: MaybeMeta<JshCli.GroundPoint> = { x: input.x, y: "z" in input ? input.z : input.y };
    if ("meta" in input) output.meta = input.meta;
    return output;
  },
};

const gdKeyRegex = /^g\d+d\d+$/;

export type Helper = typeof helper;
