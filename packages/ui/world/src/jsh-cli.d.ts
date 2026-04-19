declare namespace JshCli {
  type Event = { key: "disabled" } | { key: "enabled" } | { key: "nav-updated" } | PickEvent;

  type PickEvent = {
    key: "picked";

    clickId?: string;

    // 🚧 refine...
    meta: {
      type: string;
      instanceId: number;
      gmKey?: string;
      collapse?: boolean;
    };
  } & Pick<THREE.Intersection, "distance" | "point" | "face">;

  type DecodedObjectPick = Meta<{
    type: import("@npc-cli/ui__world").ObjectPickKey;
    instanceId: number;
  }>;
}
