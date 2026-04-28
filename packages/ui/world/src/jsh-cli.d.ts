declare namespace JshCli {
  type Event =
    | { key: "disabled" }
    | { key: "enabled" }
    | { key: "nav-updated" }
    | PickEvent
    | ({ key: "door-changed"; open: boolean } & ReturnType<import("./components/Doors").State["decodeInstanceId"]>);

  type ObjectPickKey = import("./service/pick").ObjectPickKey;
  type GroundPoint = import("./service/geometry").GroundPoint;
  type PointAnyFormat = import("./service/geometry").PointAnyFormat;

  type PickEvent = {
    key: "picked";
    clickId?: string;

    // 🚧 refine...
    meta: {
      type: ObjectPickKey;
      instanceId: number;
      gmKey?: string;
      collapse?: boolean;
    };

    gmRoomId: Geomorph.GmRoomId | null;
  } & (GroundPoint & Pick<import("three").Intersection, "distance" | "point" | "faceIndex" | "normal">);

  type DecodedObjectPick = Meta<{
    type: ObjectPickKey;
    instanceId: number;
  }>;

  interface SpawnOpts {
    // 🚧 angle, skinKey, runSpeed, walkSpeed
    // interface SpawnOpts extends Partial<Pick<NPCDef, "angle" | "classKey" | "runSpeed" | "walkSpeed">> {
    npcKey: string;
    /**
     * - Navigable points always on ground
     * - Doable points may be above ground via `meta.y`.
     */
    at?: MaybeMeta<PointAnyFormat>;

    // 🚧 facing, meta, as
    // /** Position to look towards (overrides `angle`) */
    // facing?: GroundPoint;
    // /** Can override `at?.meta`*/
    // meta?: Meta;
    // /**
    //  * Skin to apply.
    //  * - `string` for skin shortcuts e.g. `soldier-0` or `soldier-0/-///`
    //  * - object permits brace-expansion of keys.
    //  */
    // as?: string | Record<string, SkinReMapValue>;
    as?: string;
  }
}
