/** jsh's own messages to and from the nav worker, merged into the world's namespace — see `jsh.worker.ts` */
declare namespace WW {
  type DoorFrame = { gdKey: string; src: Geom.VectJson; dst: Geom.VectJson; normal: Geom.VectJson };

  /** What the worker keeps per map — see `jsh-setup` */
  type JshMapSetup = {
    mapKey: string;
    doorFrames: { [gdKey: string]: DoorFrame };
    roomDoors: { [grKey: string]: string[] };
  };

  /** A geomorph instance of the map, so the worker can place its spots */
  type GmForSpots = { key: string; transform: Geom.AffineTransform };

  /** An npc as a spot query sees them, snapshotted by main as the batch is sent. `grKeys`: theirs, and in a doorway both */
  type SpotNpc = { key: string; point: Geom.VectJson; grKeys: string[] };

  /**
   * One question about spots. `a`, `b` and `npc` are a spot key (`g0s12`) or an npc key — see `docs/spots.md`.
   * For sight an npc stands at all their spots
   */
  type SpotQuery =
    /** Their nearest spot, else with `all` every spot of theirs */
    | { q: "of"; npc: string; all?: boolean }
    | { q: "get"; key: string }
    | { q: "list"; rooms?: string[]; kinds?: string[]; near?: { npc: string; within: number } }
    | { q: "sees"; a: string; b: string }
    | { q: "seenBy"; a: string }
    /** The spot nearest a point, in room `grKey` if given */
    | { q: "at"; point: Geom.VectJson; grKey?: null | string }
    /** The best spot in `rooms` (else any) none of `from` sees, `away` metres from them if any is: of `prefer` kinds first, then nearest `npc` */
    | { q: "hide"; npc: string; from: string[]; rooms?: string[]; prefer?: string[]; exclude?: string[]; away?: number }
    /** The spot in `rooms` (else any) whose sight adds most not yet `seen`, for its distance from `npc` */
    | { q: "search"; npc: string; rooms?: string[]; seen: string[]; exclude?: string[] };

  /** A spot in world coords; `sees` counts the spots it sees */
  type SpotJson = {
    key: string;
    kind: string;
    x: number;
    y: number;
    grKey: null | string;
    facing?: number;
    /** Radians towards its nearest occluder */
    wall: number;
    sees: number;
  };

  /** Aligned with its query: `of`, `get` give a spot or `null`; `of` with `all`, `list`, `seenBy` spots; `sees` a verdict */
  type SpotAnswer =
    | null
    | SpotJson
    | SpotJson[]
    /** `crouchHides`: `b` fully crouched is hidden from `a`, by cover. `from` and `to` are a pair in sight, if any */
    | { sees: boolean; via: null | string; crouchHides: boolean; from: string; to: string }
    | { error: string };

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
        /** Everyone standing in the rooms involved */
        others: { key: string; point: Geom.VectJson; grKey: string }[];
        /** The room wanted round each */
        by: number;
      }
    | { key: "nudge"; npc: NpcQuery; to: Geom.VectJson }
    | { key: "spots"; npcs: SpotNpc[]; queries: SpotQuery[] };

  type JshOpKey = JshOp["key"];

  type JshMsgToNavWorker =
    | {
        type: "jsh-setup";
        mapKey: string;
        doorFrames: DoorFrame[];
        roomDoors: { [grKey: string]: string[] };
        gms: GmForSpots[];
        /** Changes as the dev server remakes the spot files, so the worker fetches them again */
        spotsRev: number;
      }
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
    /** Aligned with `queries` */
    spots: SpotAnswer[];
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
