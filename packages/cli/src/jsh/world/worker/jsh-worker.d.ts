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
  type SpotNpc = {
    key: string;
    point: Geom.VectJson;
    grKeys: string[];
    posture: "stand" | "sit" | "lie";
    /** Fully crouched */
    crouched: boolean;
    /** Rooms in view from theirs, as the doors stand — see `w.e.roomsInView` */
    seeRooms: string[];
    /** The doable they sit or lie at, if any */
    doAt?: Geom.VectJson;
    /** Their eyes as last posed, from their head: world XZ as `x/y`, and `h` metres up */
    eye: Geom.VectJson & { h: number };
  };

  /** One question about spots, of the perception worker — see `docs/perception.md` */
  type SpotQuery =
    | {
        /** Their nearest spot, else with `all` every spot of theirs */
        q: "of";
        /** An npc key */
        npc: string;
        /** Every spot they are at, not only the nearest */
        all?: boolean;
      }
    | {
        /** One spot */
        q: "get";
        /** A spot key, e.g. `g0s12` */
        key: string;
      }
    | {
        /** The spots in `rooms`, of `kinds`, `near` an npc: nearest first */
        q: "list";
        /** Room keys, e.g. `g0r16`: else every room */
        rooms?: string[];
        /** Spot kinds, e.g. `cover`: else every kind */
        kinds?: string[];
        /** Only those within `within` metres of an npc */
        near?: { npc: string; within: number };
      }
    | {
        /** Whether `a` sees `b`: rays if either is an npc, else the lists, with doors as they stand */
        q: "sees";
        /** Who looks: a spot or an npc */
        a: string;
        /** Who is seen: a spot or an npc */
        b: string;
      }
    | {
        /** The spots `a` sees */
        q: "seenBy";
        /** A spot, else every spot of an npc */
        a: string;
      }
    | {
        /** The spot nearest a point */
        q: "at";
        /** In world coords */
        point: Geom.VectJson;
        /** Only in this room, if given */
        grKey?: null | string;
      }
    | {
        /** The best spot none of `from` sees: of `prefer` kinds first, then nearest `npc`, `away` from them if any is */
        q: "hide";
        /** Who hides */
        npc: string;
        /** Whom from: npc keys */
        from: string[];
        /** Room keys to hide in: else any */
        rooms?: string[];
        /** Spot kinds, best first */
        prefer?: string[];
        /** Spot keys not to pick, e.g. others' or those blocked */
        exclude?: string[];
        /** Metres from each of `from`, if any spot is */
        away?: number;
        /** Where any of `from` are walking to: they are as good as there */
        ahead?: Geom.VectJson[];
      }
    | {
        /** Whether none of `from` may see `npc`, from where they stand or are headed */
        q: "hidden";
        /** Who hides */
        npc: string;
        /** Whom from: npc keys */
        from: string[];
        /** Where any of `from` are walking to */
        ahead?: Geom.VectJson[];
      }
    | {
        /** Every spot's sight from `from`, by the lists alone as the doors stand: see `SpotHow` */
        q: "view";
        /** An npc or a spot key */
        from: string;
      }
    | {
        /** How `sees` decides whether `a` sees `b`, uncached, and the lines it casts or would */
        q: "explain";
        /** Who looks: a spot or an npc */
        a: string;
        /** Who is seen: a spot or an npc */
        b: string;
      }
    | {
        /** The spot nearest `npc` in their rooms clear of a walker's `path` and of `others`, or `null` */
        q: "makeWay";
        /** Who makes way */
        npc: string;
        /** The walker's way: where they are, then their next corners */
        path: Geom.VectJson[];
        /** Where others stand or are stepping to */
        others: Geom.VectJson[];
      };

  /** A spot in world coords; `sees` counts the spots it sees */
  type SpotJson = {
    key: string;
    x: number;
    y: number;
    grKey: null | string;
    facing?: number;
    /** Radians towards its nearest occluder */
    wall: number;
    sees: number;
  } & (
    | {
        /** In a door, else either side of it */
        kind: "door" | "doorway";
        /** Its door */
        gdKey: string;
      }
    | {
        kind: "doable";
        /** Its decor, `null` until the World has keyed its decor */
        decorKey: null | string;
      }
    | { kind: Exclude<import("@npc-cli/ui__world/spot.schema").SpotKind, "door" | "doorway" | "doable"> }
  );

  /** Aligned with its query: `of`, `get` give a spot or `null`; `of` with `all`, `list`, `seenBy` spots; `sees` a verdict */
  type SpotAnswer =
    | null
    | SpotJson
    | SpotJson[]
    /** `crouchHides`: `b` fully crouched is hidden from `a`, by cover. `from` and `to` are a pair in sight, if any */
    | { sees: boolean; via: null | string; crouchHides: boolean; from: string; to: string }
    | { hidden: boolean }
    | { view: Record<string, SpotHow> }
    | {
        sees: boolean;
        settled: SeesSettled;
        /** To `b`'s centre, then either side */
        lines: { from: Geom.VectJson; to: Geom.VectJson; hit: null | SightHit }[];
        /** Their spots the lists best had seeing each other, if any */
        pair: null | [string, string];
        /** Metres up to `a`'s eye, where the lines start */
        eye: number;
        /** Metres up to the top of `b`, where they end */
        top: number;
      }
    | { error: string };

  /** A spot as seen from another, or an npc: their own, always, may, may once a shut door opens, or never */
  type SpotHow = "own" | "always" | "may" | "shut" | "never";
  /** What decided `sees`: rooms out of view, the lists (spot to spot `may` too), else lines */
  type SeesSettled = "rooms" | "never" | "always" | "may" | "lines";
  /** Where a line of sight is stopped, and by what */
  type SightHit = Geom.VectJson & { kind: import("@npc-cli/ui__world/seg-grid").Occluder["kind"] };

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
    | { key: "nudge"; npc: NpcQuery; to: Geom.VectJson };

  type JshOpKey = JshOp["key"];

  type JshMsgToNavWorker =
    | {
        type: "jsh-setup";
        mapKey: string;
        doorFrames: DoorFrame[];
        roomDoors: { [grKey: string]: string[] };
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
  };

  /** A batch of spot queries, and the npcs they name */
  type SpotsOp = { npcs: SpotNpc[]; queries: SpotQuery[] };

  /** What blocks sight, in world coords — see `sightOccluders` in `spot-sight.ts` */
  type SightOccluder = {
    a: Geom.VectJson;
    b: Geom.VectJson;
    kind: "wall" | "door" | "obstacle" | "low";
    id: number;
    /** A `low` one's height */
    top?: number;
  };

  /** To the perception worker — see `perception.worker.ts` */
  type PerceptionMsgTo =
    | {
        /** A map to answer for, sent whole: on its first query, and again once the map, layout or spots change */
        type: "perception-setup";
        /** The map, which keys its spots with `gms` and `spotsRev` */
        mapKey: string;
        /** The map's geomorph instances, by gmId: whose spot files it fetches, and where it places them */
        gms: GmForSpots[];
        /** Changes as the dev server remakes the spot files, so the worker fetches them again */
        spotsRev: number;
        /** What blocks sight across the whole map, in world coords */
        occluders: SightOccluder[];
        /** gdKeys of doors seen through */
        openDoors: string[];
        /** The two records of each hull door where geomorphs meet, as gdKeys */
        hullPairs: [string, string][];
        /** By `{gmId}/{decorId}`, each doable's decor key */
        doableKeys: Record<string, string>;
      }
    | {
        /** A door now seen through, or shut */
        type: "perception-door";
        /** The door, e.g. `g0d12` */
        gdKey: string;
        /** Seen through: opening or open */
        open: boolean;
      }
    | {
        /** A batch of spot queries, answered by a `perception-result` with the same `uid` */
        type: "perception-query";
        /** Matches the query to its answer */
        uid: string;
        /** The queries, and the npcs they name as main saw them */
        op: SpotsOp;
      };

  /** From the perception worker — see `perception.worker.ts` */
  type PerceptionMsgFrom =
    | {
        /** A query's answers, else why none */
        type: "perception-result";
        /** The query's `uid` */
        uid: string;
        /** Aligned with the query's `queries`: one that failed is `{ error }`, not the batch */
        output: SpotAnswer[];
        /** Why the whole batch failed, e.g. no spots set up */
        error?: string;
      }
    | {
        /** Its own code changed: main respawns it and sets it up again */
        type: "worker-hot-module-reload";
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
