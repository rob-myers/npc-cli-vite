declare namespace JshCli {
  type Event =
    | { key: "disabled" }
    | ({ key: "door-open" | "door-closed" | "door-opening" | "door-closing"; open: boolean } & ReturnType<
        import("./components/Doors").State["decodeInstanceId"]
      >)
    | { key: "enabled" }
    | ({ key: "enter-collider"; npcKey: string } & BaseColliderEvent)
    | ({ key: "exit-collider"; npcKey: string } & BaseColliderEvent)
    | { key: "nav-updated" }
    | PickEvent
    | { key: "removed-npcs"; npcKeys: string[] }
    | { key: "spawned"; npcKey: string; gmRoomId: Geomorph.GmRoomId }
    | { key: "requested-physics" };

  type ObjectPickKey = import("./service/pick").ObjectPickKey;
  type GroundPoint = import("./service/geometry").GroundPoint;
  type PointAnyFormat = import("./service/geometry").PointAnyFormat;
  type BaseColliderEvent = { type: "circle" | "rect"; decorKey: string } | ({ type: "nearby" } & Geomorph.GmDoorId);

  type PickEvent = {
    key: "picked";
    clickId?: string;

    meta: import("./components/WorldView").Picked;

    gmRoomId: Geomorph.GmRoomId | null;
  } & (GroundPoint & Pick<import("three").Intersection, "distance" | "point" | "faceIndex" | "normal">);

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
