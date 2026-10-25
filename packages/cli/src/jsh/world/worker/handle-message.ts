import { getNavMesh } from "@npc-cli/ui__world/worker/nav";
import { ops } from "./plan.worker";

/** What the worker keeps per map, replaced by each `jsh-setup` */
let map: WW.JshMapSetup = { mapKey: "", doorFrames: {}, roomDoors: {} };

export function setupPlan(msg: WW.JshSetup) {
  const doorFrames = Object.fromEntries(msg.doorFrames.map((frame) => [frame.gdKey, frame]));
  map = { mapKey: msg.mapKey, doorFrames, roomDoors: msg.roomDoors };
}

/** Runs an op off the listener, and always answers — else main waits forever */
export async function runOp(msg: WW.JshRequest) {
  let output: unknown = null;
  let error: undefined | string;
  try {
    const navMesh = getNavMesh();
    if (navMesh === null) throw Error("no navmesh");
    output = await finish(ops[msg.op.key](msg.op as never, navMesh, map));
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  self.postMessage({ type: "jsh-plan-result", uid: msg.uid, key: msg.op.key, output, error } as WW.JshMsgFromNavWorker);
}

/**
 * An op's result, whatever kind it is: a value or a promise is awaited; a generator, sync or
 * async, is stepped, and each of its yields lets the nav worker's queue run, e.g. a raycast
 * behind a long op
 */
async function finish(result: unknown) {
  if (typeof (result as Generator)?.next !== "function") return await result;
  const gen = result as Generator<void, unknown> | AsyncGenerator<void, unknown>;
  let step = await gen.next();
  while (step.done !== true) {
    await (self.scheduler?.yield() ?? new Promise((resolve) => setTimeout(resolve)));
    step = await gen.next();
  }
  return step.value;
}

/** Not yet in the lib types — nor in every browser, hence the fallback above */
declare const self: { scheduler?: { yield(): Promise<void> }; postMessage(msg: unknown): void };
