declare namespace WW {
  type MsgToWorker =
    | { type: "ping" }
    | {
        type: "request-tiled-navmesh";
        mapKey: string;
        /** PROD webworker needs to know about hull symbol edits too */
        mapEditDrafts?: import("@npc-cli/ui__map-edit/editor.schema").MapEditSavedFileJson[];
      };

  type MsgFromWorker =
    | { type: "pong" }
    | ({
        type: "tiled-navmesh-response";
        toNavTris: import("./worker/nav-util").FloorNavTris;
      } & import("navcat/blocks").TiledNavMeshResult);

  type TiledNavMeshResponse = Extract<MsgFromWorker, { type: "tiled-navmesh-response" }>;
}
