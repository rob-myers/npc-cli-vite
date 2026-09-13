/** jsh's own messages to and from the world worker — see `jsh.worker.ts` */
declare namespace JshWW {
  type DoorFrame = { gdKey: string; src: Geom.VectJson; dst: Geom.VectJson; normal: Geom.VectJson };

  /** What the worker keeps per map — see `jsh-setup` */
  type MapSetup = {
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

  /** An op and its input — see `plan.worker.ts` for what each gives */
  type Op =
    | {
        key: "park";
        npcs: NpcQuery[];
        /** Everyone parked, with the seg they stand against */
        parked: { key: string; point: Geom.VectJson; grKey: string; seg: number[] }[];
      }
    | { key: "boundary"; npc: NpcQuery }
    | { key: "pad"; npc: NpcQuery; by: number }
    | { key: "nudge"; npc: NpcQuery; to: Geom.VectJson };

  type OpKey = Op["key"];

  /** What each op gives */
  type Output = {
    /** Aligned with `npcs`; `null` where no wall was within range */
    park: (null | ParkPlan)[];
    /** The boundary segments `[x1, y1, z1, x2, y2, z2]` within reach, nearest first */
    boundary: number[][];
    /** A step of `by` off the nearest wall, along its inward normal — `null` with no wall in reach */
    pad: null | Geom.VectJson;
    /** `to`, slid along the navmesh from where they stand — `null` off the mesh */
    nudge: null | Geom.VectJson;
  };

  type Request = { type: "jsh-plan"; uid: string; op: Op };
  type Result<K extends OpKey = OpKey> = {
    [J in K]: {
      type: "jsh-plan-result";
      uid: string;
      key: J;
      output: Output[J];
      /** e.g. "no navmesh" whilst the world worker is still generating it */
      error?: string;
    };
  }[K];

  type MsgToWorker =
    | { type: "jsh-setup"; mapKey: string; doorFrames: DoorFrame[]; roomDoors: { [grKey: string]: string[] } }
    | Request;

  type MsgFromWorker = Result;
}
