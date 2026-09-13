import { workerStore } from "@npc-cli/ui__world/worker/store";
import { ops } from "./plan.worker";

/** What the worker keeps per map, replaced by each `jsh-setup` */
let map: JshWW.MapSetup = { mapKey: "", doorFrames: {}, roomDoors: {} };

/** Runs an op off the listener, and always answers — else main waits forever */
async function runOp(msg: JshWW.Request) {
  let output: unknown = null;
  let error: undefined | string;
  try {
    const { navMesh } = workerStore.getState();
    if (navMesh === null) throw Error("no navmesh");
    output = await finish(ops[msg.op.key](msg.op as never, navMesh, map));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  self.postMessage({ type: "jsh-plan-result", uid: msg.uid, key: msg.op.key, output, error } as JshWW.MsgFromWorker);
}

/** Each of the op's yields lets the world worker's queue run, e.g. the physics behind a long op */
async function finish(op: Generator<void, unknown>) {
  let step = op.next();
  while (step.done !== true) {
    await (self.scheduler?.yield() ?? new Promise((resolve) => setTimeout(resolve)));
    step = op.next();
  }
  return step.value;
}

/** Not yet in the lib types — nor in every browser, hence the fallback above */
declare const self: { scheduler?: { yield(): Promise<void> }; postMessage(msg: unknown): void };

/** jsh's cases; `false` leaves the message to the world worker */
export function handleJshMessage(data: unknown): boolean {
  const msg = data as JshWW.MsgToWorker;
  switch (msg?.type) {
    case "jsh-setup": {
      const doorFrames = Object.fromEntries(msg.doorFrames.map((frame) => [frame.gdKey, frame]));
      map = { mapKey: msg.mapKey, doorFrames, roomDoors: msg.roomDoors };
      return true;
    }
    case "jsh-plan": {
      void runOp(msg);
      return true;
    }
    default:
      return false;
  }
}
