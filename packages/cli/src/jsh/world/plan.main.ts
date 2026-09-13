/// <reference path="./worker/types.d.ts" />

/**
 * One op on jsh's side of the worker, under the shell's pause/kill — see `worker/plan.worker.ts`
 * for the ops, and `awaitPausable` for what a pause or kill does
 */
export function plan<O extends JshWW.Op>({ api, w, op }: Pick<JshCli.RunArg, "api" | "w"> & { op: O }) {
  return awaitPausable(api, (signal) => request(w, api, op, signal));
}

/** An npc as an op sees them: where they stand, their poly, their room and the doors they may not pass */
export function npcQuery(w: JshCli.WorldState, npc: JshCli.Npc): JshWW.NpcQuery {
  const agent = npc.agent;
  if (agent === null) throw Error("no agent");
  // an npc stood IN a doorway resolves to one of its two rooms, which owns that door either way
  const grKey = (w.e.npcToRoom.get(npc.key) ?? w.e.findRoomContaining(npc.point, true))?.grKey ?? null;
  const doors = grKey === null ? [] : getRoomDoorKeys(w, grKey);
  return {
    key: npc.key,
    point: npc.point,
    nodeRef: w.npc.getNodeRef(agent),
    grKey,
    blockedGdKeys: doors.filter((gdKey) => w.e.npcCanAccess(npc.key, gdKey) === false),
  };
}

/**
 * Runs `run` under the shell's pause/kill: a kill aborts with the kill error, a pause aborts with
 * `"paused"` and reruns once resumed — `run` decides what an abort interrupts
 */
export async function awaitPausable<T>(
  api: JshCli.RunArg["api"],
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  while (true) {
    const abort = new AbortController();
    const handlers = api.handleStatus({
      cleanup: (killed) => void (killed === true && abort.abort(api.getKillError())),
      onSuspend: () => {
        abort.abort(Error("paused"));
        return true;
      },
    });
    try {
      const result = await run(abort.signal);
      await api.awaitResume(); // in case a fade was let finish whilst suspended
      return result;
    } catch (e) {
      if (isPaused(e) === false) throw e;
      await api.awaitResume();
    } finally {
      handlers.dispose();
    }
  }
}

/** One request to the worker, which is set up for the map first if need be */
export function request<O extends JshWW.Op>(
  w: JshCli.WorldState,
  api: JshCli.RunArg["api"],
  op: O,
  signal: AbortSignal,
) {
  const worker = getWorker(w);
  ensureSetup(w, worker);
  const uid = api.getUid();
  return new Promise<JshWW.Output[O["key"]]>((resolve, reject) => {
    signal.throwIfAborted();
    const onMessage = (e: MessageEvent<JshWW.MsgFromWorker>) => {
      if (e.data?.type !== "jsh-plan-result" || e.data.uid !== uid) return;
      worker.removeEventListener("message", onMessage);
      e.data.error === undefined ? resolve(e.data.output as JshWW.Output[O["key"]]) : reject(Error(e.data.error));
    };
    worker.addEventListener("message", onMessage);
    signal.addEventListener("abort", () => (worker.removeEventListener("message", onMessage), reject(signal.reason)), {
      once: true,
    });
    worker.postMessage({ type: "jsh-plan", uid, op } satisfies JshWW.Request);
  });
}

export function isPaused(e: unknown) {
  return e instanceof Error && e.message === "paused";
}

/** The worker is told a map's door frames and room doors once, before the first request on it */
function ensureSetup(w: JshCli.WorldState, worker: Worker) {
  if (setupMapKey.get(worker) === w.mapKey) return;
  const rooms = w.gmRoomGraph.nodesArray.flatMap((node) => (node.type === "room" ? node.grKey : []));
  worker.postMessage({
    type: "jsh-setup",
    mapKey: w.mapKey,
    doorFrames: Object.values(w.d).map(({ gdKey, src, dst, normal }) => ({ gdKey, src, dst, normal })),
    roomDoors: Object.fromEntries(rooms.map((grKey) => [grKey, getRoomDoorKeys(w, grKey)])),
  } satisfies JshWW.MsgToWorker);
  setupMapKey.set(worker, w.mapKey);
}

function getRoomDoorKeys(w: JshCli.WorldState, grKey: Geomorph.GmRoomKey) {
  const node = w.gmRoomGraph.getNode(grKey);
  return node === null ? [] : w.gmRoomGraph.getSuccs(node).flatMap((succ) => (succ.type === "door" ? succ.gdKey : []));
}

function getWorker(w: JshCli.WorldState) {
  const worker = w.worker.worker;
  if (!(worker instanceof Worker)) throw Error("worker not ready"); // a stub swallows posts before it mounts
  return worker;
}

/** The map each worker was last set up for */
const setupMapKey = new WeakMap<Worker, string>();
