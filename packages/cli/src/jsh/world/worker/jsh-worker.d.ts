/** jsh's own messages to and from the nav worker, merged into the world's namespace — see `jsh.worker.ts` */
declare namespace WW {
  type DoorFrame = { gdKey: string; src: Geom.VectJson; dst: Geom.VectJson; normal: Geom.VectJson };

  /** What the worker keeps per map — see `jsh-setup` */
  type JshMapSetup = {
    mapKey: string;
    doorFrames: { [gdKey: string]: DoorFrame };
    roomDoors: { [grKey: string]: string[] };
  };

  /** An npc, as an op sees them — see `npcQuery` in `plan.main.ts` */
  type NpcQuery = {
    key: string;
    point: Geom.VectJson;
    /** Their poly, as main knows it; looked up here if stale */
    nodeRef: number;
    grKey: null | string;
    /** Doors they may not pass */
    blockedGdKeys: string[];
  };

  /** A parking spot, its facing, and the wall segment `[x1, y1, z1, x2, y2, z2]` it stands against */
  type ParkPlan = { key: string; at: Geom.VectJson; facing: Geom.VectJson; seg: number[] };
  type PadPlan = { key: string; at: Geom.VectJson };

  /** A jsh op and its input — see `plan.worker.ts` for what each gives */
  type JshOp =
    | {
        key: "park";
        npcs: NpcQuery[];
        /** Everyone parked, with the seg they stand against */
        parked: { key: string; point: Geom.VectJson; grKey: string; seg: number[] }[];
      }
    | { key: "boundary"; npc: NpcQuery }
    | {
        key: "pad";
        npcs: NpcQuery[];
        /** Everyone parked or padded */
        others: { key: string; point: Geom.VectJson; grKey: string }[];
        /** The room wanted round each */
        by: number;
      }
    | { key: "nudge"; npc: NpcQuery; to: Geom.VectJson };

  type JshOpKey = JshOp["key"];

  type JshMsgToNavWorker =
    | { type: "jsh-setup"; mapKey: string; doorFrames: DoorFrame[]; roomDoors: { [grKey: string]: string[] } }
    | JshRequest;

  type JshMsgFromNavWorker = JshResult;

  /** What each op gives */
  type JshOutput = {
    /** Aligned with `npcs`; `null` where no wall was within range, or none had a clear point */
    park: (null | ParkPlan)[];
    /** The boundary segments `[x1, y1, z1, x2, y2, z2]` within reach, nearest first */
    boundary: number[][];
    /** Aligned with `npcs`; `null` where no spot had the room */
    pad: (null | PadPlan)[];
    /** `to`, slid along the navmesh from where they stand — `null` off the mesh */
    nudge: null | Geom.VectJson;
  };

  type JshRequest = { type: "jsh-plan"; uid: string; op: JshOp };
  type JshResult<K extends JshOpKey = JshOpKey> = {
    [J in K]: {
      type: "jsh-plan-result";
      uid: string;
      key: J;
      output: JshOutput[J];
      /** e.g. "no navmesh" whilst the nav worker is still generating it */
      error?: string;
    };
  }[K];
}
