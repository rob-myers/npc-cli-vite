declare namespace WW {
  type MsgToWorker =
    | { type: "ping" }
    | {
        type: "request-tiled-navmesh";
        mapKey: string;
        gmGeoms: WW.GmGeomForNav[];
      };

  type MsgFromWorker =
    | { type: "pong" }
    | ({
        type: "tiled-navmesh-response";
        toNavTris: import("./worker/nav-util").FloorNavTris;
      } & import("navcat/blocks").TiledNavMeshResult)
    | { type: "worker-hot-module-reload" };

  type TiledNavMeshResponse = Extract<MsgFromWorker, { type: "tiled-navmesh-response" }>;

  /**
   * Geomorph geometry for navigation mesh generation.
   * - We've carefully extracted the needed parts to avoid overlap with main thread.
   * - This avoids HMR issues e.g. on edit packages/ui/world/src/const.ts
   */
  type GmGeomForNav = {
    key: import("@npc-cli/media/starship-symbol").StarShipGeomorphKey;
    triangulation: Geom.TriangulationJson;
    determinant: number;
    gridRect: Geom.RectJson;
    inverseMat3: Geom.AffineTransform;
    mat4Array: number[]; // 16 numbers, column-major
  };
}
