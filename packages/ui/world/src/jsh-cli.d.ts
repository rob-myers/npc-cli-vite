declare namespace JshCli {
  type Event = { key: "disabled" } | { key: "enabled" } | { key: "nav-updated" } | PickEvent;

  type ObjectPickKey = import("@npc-cli/ui__world").ObjectPickKey;

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
  } & Pick<THREE.Intersection, "distance" | "point" | "face">;

  type DecodedObjectPick = Meta<{
    type: ObjectPickKey;
    instanceId: number;
  }>;
}
