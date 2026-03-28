declare namespace WW {
  type MsgToWorker = { type: "ping" } | { type: "request-tiled-navmesh"; mapKey: string };

  type MsgFromWorker =
    | { type: "pong" }
    | { type: "tiled-navmesh-response"; tiledNavMeshResult: import("navcat/blocks").TiledNavMeshResult };
}
