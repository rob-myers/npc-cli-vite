declare namespace WW {
  type MsgToWorker =
    | { type: "ping" }
    | {
        type: "request-tiled-navmesh";
        mapKey: string;
        gmGeoms: WW.GmGeomForNav[];
      }
    | PhysicsMsgToWorker;

  type PhysicsMsgToWorker =
    // | AddNPCs
    // | AddColliders
    | {
        type: "get-physics-debug-data";
      }
    // | GetRaycast
    // | RemoveBodies
    // | RemoveColliders
    // | SendNpcPositions
    | {
        type: "setup-physics";
        mapKey: string;
        npcs: NpcDef[];
        assets: import("./assets.schema").AssetsEncodedType;
      };

  type GetPhysicsDebugData = Extract<PhysicsMsgToWorker, { type: "get-physics-debug-data" }>;
  type SetupPhysicsWorld = Extract<PhysicsMsgToWorker, { type: "setup-physics" }>;

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
    | PhysicsMsgFromWorker;

  type PhysicsMsgFromWorker =
    | {
        type: "world-setup-response";
      }
    // | NpcCollisionResponse
    | {
        type: "physics-debug-data-response";
        items: PhysicDebugItem[];
        /** [ux, uy, vx, vy, ...] */
        lines: number[];
      };
  // | RaycastResultResponse

  type WorldSetupResponse = Extract<MsgFromWorker, { type: "world-setup-response" }>;
  type PhysicsDebugDataResponse = Extract<MsgFromWorker, { type: "physics-debug-data-response" }>;
  type TiledNavMeshResponse = Extract<MsgFromWorker, { type: "tiled-navmesh-response" }>;

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
    mat4Array: number[]; // 16 numbers, column-major
  };

  type GmDoorwayForNav = {
    gmId: number;
    doorId: number;
    polygon: Geom.GeoJsonPolygon;
  };

  type PhysicDebugItem = {
    parsedKey: PhysicsParsedBodyKey;
    userData: PhysicsUserData;
    position: import("three").Vector3Like;
    enabled: boolean;
  };

  type PhysicsParsedBodyKey = ["npc" | "circle" | "rect", string] | ["nearby", Geomorph.GmDoorKey]; // sensor for door

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
    | `rect ${string}`; // custom cuboid collider (possibly angled)
}
