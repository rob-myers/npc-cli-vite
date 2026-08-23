declare namespace WW {
  type MsgToWorker =
    | { type: "ping" }
    | {
        type: "request-tiled-navmesh";
        mapKey: string;
        gmGeoms: WW.GmGeomForNav[];
      }
    | RoomGraphMsgToWorker
    | PhysicsMsgToWorker;

  type RoomGraphMsgToWorker =
    | {
        /** The room graph itself, on map change and on worker reload */
        type: "request-room-graph";
        mapKey: string;
        roomGraph: RoomGraphForWorker;
      }
    | {
        /** Can this npc reach `dstIndex` from `srcIndex`, given the doors they may pass? */
        type: "request-unreachable";
        uid: string;
        srcIndex: number;
        dstIndex: number;
        /** Node indices of the doors this npc has been granted */
        accessDoorIndices: number[];
        /**
         * Which doors are locked, and which stand open — a flag per NODE index, so a door's state
         * is read at the same index the graph knows it by. Sent with every query rather than as it
         * changes: doors open and close constantly, and this way nothing has to stay in step
         */
        locked: Uint8Array;
        open: Uint8Array;
      };

  type RequestRoomGraph = Extract<RoomGraphMsgToWorker, { type: "request-room-graph" }>;
  type RequestUnreachable = Extract<RoomGraphMsgToWorker, { type: "request-unreachable" }>;

  type PhysicsMsgToWorker =
    | {
        type: "add-physics-npcs";
        npcs: NpcDef[];
      }
    | {
        type: "add-physics-colliders";
        colliders: PhysicsColliderDef[];
      }
    | {
        type: "get-physics-debug-data";
      }
    | {
        type: "remove-physics-bodies";
        bodyKeys: WW.PhysicsBodyKey[];
      }
    | {
        type: "remove-physics-colliders";
        colliders: { type: "circle" | "rect"; colliderKey: string }[];
      }
    | {
        // 🔔 Float32Array caused issues i.e. decode failed
        type: "send-npc-positions";
        positions: Float64Array;
      }
    | {
        type: "setup-physics";
        mapKey: string;
        npcs: NpcDef[];
        doors: PhysicsDoorDef[];
        rayCast: RaycastSetupData;
        runtimeColliderDefs: WW.PhysicsColliderDef[];
      }
    | {
        type: "get-raycast";
        uid: string;
        src: Geom.VectJson;
        dst: Geom.VectJson;
        gmId: number;
      };

  type AddPhysicsColliders = Extract<PhysicsMsgToWorker, { type: "add-physics-colliders" }>;
  type AddPhysicsNPCs = Extract<PhysicsMsgToWorker, { type: "add-physics-npcs" }>;
  type GetPhysicsDebugData = Extract<PhysicsMsgToWorker, { type: "get-physics-debug-data" }>;
  type RemovePhysicsBodies = Extract<PhysicsMsgToWorker, { type: "remove-physics-bodies" }>;
  type RemovePhysicsColliders = Extract<PhysicsMsgToWorker, { type: "remove-physics-colliders" }>;
  type SendNpcPhysicsPositions = Extract<PhysicsMsgToWorker, { type: "send-npc-positions" }>;
  type SetupPhysicsWorld = Extract<PhysicsMsgToWorker, { type: "setup-physics" }>;
  type GetRaycast = Extract<PhysicsMsgToWorker, { type: "get-raycast" }>;

  /** Colliders always on ground hence 2D position suffices */
  type PhysicsColliderDef = Geom.VectJson &
    PhysicsBodyGeom & {
      /** For gm decor this is a `decorKey`. */
      colliderKey: string;
      /** Only applicable when `type` is `"rect"` */
      angle?: number;
      userData?: Record<string, any>;
    };

  type PhysicsBodyGeom =
    | {
        /** Induces cylinder placed on floor with wall's height.  */
        type: "circle";
        radius: number;
      }
    | {
        /** Induces cuboid placed on floor with wall's height.  */
        type: "rect";
        /** x-ordinate */
        width: number;
        /** z-ordinate */
        height: number;
      };

  type NpcDef = {
    npcKey: string;
    position: import("three").Vector3Like;
  };

  type MsgFromWorker =
    | { type: "pong" }
    | ({
        type: "tiled-navmesh-response";
        toNavTris: import("./worker/nav-util").GmFloorNavTris;
      } & import("navcat/blocks").TiledNavMeshResult)
    | { type: "worker-hot-module-reload" }
    | {
        type: "unreachable-result";
        uid: string;
        /** `null` iff the npc can get there — the door node they'd be stopped by otherwise */
        blocked: null | { doorIndex: number; roomIndex: number };
      }
    | PhysicsMsgFromWorker;

  type PhysicsMsgFromWorker =
    | {
        type: "world-setup-response";
      }
    | {
        type: "npc-collisions";
        collisionStart: { npcKey: string; otherKey: PhysicsBodyKey }[];
        collisionEnd: { npcKey: string; otherKey: PhysicsBodyKey }[];
      }
    | {
        type: "physics-debug-data-response";
        items: PhysicDebugItem[];
        /** [ux, uy, vx, vy, ...] */
        lines: number[];
      }
    | {
        type: "raycast-result";
        uid: string;
        hit: null | Geom.VectJson;
        gmDoorIds: Geomorph.GmDoorId[];
      };

  type NpcCollisionResponse = Extract<MsgFromWorker, { type: "npc-collisions" }>;
  type WorldSetupResponse = Extract<MsgFromWorker, { type: "world-setup-response" }>;
  type PhysicsDebugDataResponse = Extract<MsgFromWorker, { type: "physics-debug-data-response" }>;
  type TiledNavMeshResponse = Extract<MsgFromWorker, { type: "tiled-navmesh-response" }>;
  type RaycastResultResponse = Extract<MsgFromWorker, { type: "raycast-result" }>;
  type UnreachableResult = Extract<MsgFromWorker, { type: "unreachable-result" }>;

  /**
   * `gmRoomGraph` as plain arrays, indexed by each node's own `index`.
   * - Carefully extracted so the worker shares no module with the main thread — see `GmGeomForNav`
   * - Rooms, doors and windows are all nodes; a hull door also neighbours the door it meets
   */
  type RoomGraphForWorker = {
    /** `RoomGraphNodeType` per node */
    nodeType: Uint8Array;
    /** `grKey` / `gdKey` / window key per node, so results can be spoken in main-thread terms */
    nodeId: string[];
    /** `x, y` per node — the centroids `findBlockingDoor` measures with */
    centroid: Float32Array;
    /** Neighbours of node `i` are `adjNode[adjOffset[i] .. adjOffset[i + 1]]` */
    adjOffset: Int32Array;
    adjNode: Int32Array;
  };

  /** Values of `RoomGraphForWorker["nodeType"]` */
  type RoomGraphNodeType = 0 | 1 | 2;

  /**
   * Geomorph geometry for navigation mesh generation.
   * - We've carefully extracted the needed parts to avoid overlap with main thread.
   * - This avoids HMR issues e.g. on edit packages/ui/world/src/const.ts
   */
  type GmGeomForNav = {
    key: import("@npc-cli/media/starship-symbol").StarShipGeomorphKey;
    doorways: GmDoorwayForNav[];
    triangulation: Geom.TriangulationJson;
    determinant: number;
    worldBounds: Geom.RectJson;
    gridRect: Geom.RectJson;
    inverseMat3: Geom.AffineTransform;
    mat3: Geom.AffineTransform;
    mat4Array: number[]; // 16 numbers, column-major
  };

  type GmDoorwayForNav = {
    gmId: number;
    doorId: number;
    polygon: Geom.GeoJsonPolygon;
  };

  type PhysicsDoorDef = {
    gdKey: `g${number}d${number}`;
    center: { x: number; y: number };
    angle: number;
    baseWidth: number;
    baseHeight: number;
  };

  type PhysicDebugItem = {
    parsedKey: PhysicsParsedBodyKey;
    userData: PhysicsUserData;
    position: import("three").Vector3Like;
    enabled: boolean;
  };

  type PhysicsParsedBodyKey =
    | ["npc" | "circle" | "rect", string]
    | ["nearby", Geomorph.GmDoorKey]
    | ["inside", Geomorph.GmDoorKey]; // sensor for door

  /**
   * Height is always fixed.
   */
  type PhysicsUserData = BasePhysicsUserData &
    (
      | { type: "npc"; radius: number }
      | { type: "cylinder"; radius: number }
      | { type: "cuboid"; width: number; depth: number; angle: number }
    );

  type BasePhysicsUserData = {
    bodyKey: WW.PhysicsBodyKey;
    /** This is the numeric hash of `bodyKey` */
    bodyUid: number;
    /** Custom UserData */
    custom?: Record<string, any>;
  };

  type PhysicsBodyKey =
    | `circle ${string}` // custom cylindrical collider
    | `npc ${string}` // npc {npcKey}
    | `nearby ${Geomorph.GmDoorKey}` // door neighbourhood
    | `inside ${Geomorph.GmDoorKey}` // inside door sensor
    | `rect ${string}`; // custom cuboid collider (possibly angled)

  type RaycastSetupData = {
    [gmKey: string]: {
      key: Geomorph.StarShipGeomorphKey;
      doors: Geom.GeoJsonPolygon[];
      walls: Geom.GeoJsonPolygon[];
    };
  };
}
