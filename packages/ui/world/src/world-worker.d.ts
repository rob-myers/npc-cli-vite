declare namespace WW {
  type MsgToWorker = { type: "ping" } | { type: "test-generate-tiled-navmesh" };

  type MsgFromWorker = { type: "pong" } | { type: "test-generate-tiled-navmesh-result"; data: any };
}
