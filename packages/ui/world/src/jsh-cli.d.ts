declare namespace JshCli {
  type Event =
    | { key: "disabled" }
    | ({ key: "door-open" | "door-closed" | "door-opening" | "door-closing"; open: boolean } & ReturnType<
        import("./components/Doors").State["decodeInstanceId"]
      >)
    | ({ key: "door-locked" | "door-unlocked"; locked: boolean } & ReturnType<
        import("./components/Doors").State["decodeInstanceId"]
      >)
    | { key: "enabled" }
    | ({ key: "enter-collider"; npcKey: string } & BaseColliderEvent)
    | { key: "enter-room"; npcKey: string; gmRoomId: Geomorph.GmRoomId }
    | ({ key: "exit-collider"; npcKey: string } & BaseColliderEvent)
    | { key: "nav-updated" }
    | PickEvent
    | { key: "removed-npcs"; npcKeys: string[] }
    | { key: "spawned"; npcKey: string; gmRoomId: Geomorph.GmRoomId }
    | { key: "started-moving"; npcKey: string }
    | { key: "requested-physics" }
    | {
        /** Try close door after countdown and keep trying thereafter */
        key: "try-close-door";
        gdKey: Geomorph.GmDoorKey;
        meta?: Meta;
      };

  type ObjectPickKey = import("./service/pick").ObjectPickKey;
  type GroundPoint = import("./service/geometry").GroundPoint;
  type PointAnyFormat = import("./service/geometry").PointAnyFormat;

  type BaseColliderEvent =
    | { type: "circle" | "rect"; decorKey: string }
    | ({ type: "nearby" | "inside" } & Geomorph.GmDoorId);

  type PickEvent = {
    key: "picked";
    clickId?: string;
    meta: import("./components/WorldView").Picked;
    gmRoomId: Geomorph.GmRoomId | null;

    /** Was previous pointerdown held down long? */
    longDown: boolean;
    /** Was right mouse button being pressed?  */
    rightDown: boolean;
  } & (GroundPoint & Pick<import("three").Intersection, "distance" | "point" | "faceIndex" | "normal">);

  type EnterColliderEvent = Extract<Event, { key: "enter-collider" }>;
  type ExitColliderEvent = Extract<Event, { key: "exit-collider" }>;

  type SpawnOpts = {
    npcKey: string;
    /**
     * - Navigable points always on ground
     * - Doable points may be above ground via `meta.y`.
     */
    at?: MaybeMeta<PointAnyFormat>;
    angle?: number;
    /** Position to look towards: overrides `angle` */
    facing?: PointAnyFormat;
    // /**
    //  * Skin to apply.
    //  * - `string` for skin shortcuts e.g. `soldier-0` or `soldier-0/-///`
    //  * - object permits brace-expansion of keys.
    //  */
    // as?: string | Record<string, SkinReMapValue>;
    as?: string;
  };

  type MoveOpts = {
    npcKey: string;
    to: JshCli.PointAnyFormat;
    arrive?: boolean;
    fast?: boolean;
  };
}
