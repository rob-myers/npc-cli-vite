declare namespace JshCli {
  type Event = { key: "disabled" } | { key: "enabled" } | { key: "nav-updated" } | PickEvent;

  type PickEvent = {
    key: "picked";

    clickId?: string;
    intersection: Pick<THREE.Intersection, "distance" | "point" | "face">;

    // 🚧 refine...
    meta: {
      type: string;
      instanceId: number;
      gmKey?: string;
      collapse?: boolean;
    };
  };

  type DecodedObjectPick = Meta<{
    type: import("@npc-cli/ui__world").ObjectPickKey;
    instanceId: number;
  }>;
}
