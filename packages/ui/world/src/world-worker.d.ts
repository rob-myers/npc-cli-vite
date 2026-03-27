declare namespace WW {
  type MsgToWorker = { type: "ping" };

  type MsgFromWorker = { type: "pong" };
}
