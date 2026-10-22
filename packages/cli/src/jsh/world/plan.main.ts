/// <reference path="./worker/jsh-worker.d.ts" />

import { parked } from "./pred";

/**
 * One plan op on the nav worker, which `worker/jsh.worker.ts` extends, under the shell's pause/kill.
 * The ops are in `worker/plan.worker.ts`. Spots and sight are the perception worker's: see `perception.main.ts`
 */
export function plan<O extends WW.JshOp>({ api, w, op }: Pick<JshCli.RunArg, "api" | "w"> & { op: O }) {
  return awaitPausable(api, (signal) => request(w, api, op, signal));
}

/** An npc as an op sees them: where they stand, their poly, their room and the doors they may not pass */
export function npcQuery(w: JshCli.WorldState, npc: JshCli.Npc): WW.NpcQuery {
  const agent = npc.agent;
  if (agent === null) throw Error("no agent");
  // an npc stood IN a doorway resolves to one of its two rooms, which owns that door either way
  const grKey = (w.npc.npcToRoom.get(npc.key) ?? w.findRoomContaining(npc.point, true))?.grKey ?? null;
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
export function request<O extends WW.JshOp>(
  w: JshCli.WorldState,
  api: JshCli.RunArg["api"],
  op: O,
  signal: AbortSignal,
) {
  return post(w, api.getUid(), op, signal);
}

/** `request` from no process, e.g. a keyed listener: nothing pauses or kills it */
export function requestDetached<O extends WW.JshOp>(w: JshCli.WorldState, op: O) {
  return post(w, `detached-${++detachedUid}`, op, new AbortController().signal);
}

let detachedUid = 0;

function post<O extends WW.JshOp>(w: JshCli.WorldState, uid: string, op: O, signal: AbortSignal) {
  const worker = getWorker(w);
  ensureSetup(w, worker);
  return new Promise<WW.JshOutput[O["key"]]>((resolve, reject) => {
    signal.throwIfAborted();
    const onMessage = (e: MessageEvent<WW.JshMsgFromNavWorker>) => {
      if (e.data?.type !== "jsh-plan-result" || e.data.uid !== uid) return;
      worker.removeEventListener("message", onMessage);
      e.data.error === undefined ? resolve(e.data.output as WW.JshOutput[O["key"]]) : reject(Error(e.data.error));
    };
    worker.addEventListener("message", onMessage);
    signal.addEventListener("abort", () => (worker.removeEventListener("message", onMessage), reject(signal.reason)), {
      once: true,
    });
    worker.postMessage({ type: "jsh-plan", uid, op } satisfies WW.JshRequest);
  });
}

export function isPaused(e: unknown) {
  return e instanceof Error && e.message === "paused";
}

/** The worker is told a map's door frames and room doors once, before the first request on it */
function ensureSetup(w: JshCli.WorldState, worker: Worker) {
  const setupKey = `${w.mapKey} ${w.gmsHash}`;
  if (setupMapKey.get(worker) === setupKey) return;
  const rooms = w.gmRoomGraph.nodesArray.flatMap((node) => (node.type === "room" ? node.grKey : []));
  worker.postMessage({
    type: "jsh-setup",
    mapKey: w.mapKey,
    doorFrames: Object.values(w.d).map(({ gdKey, src, dst, normal }) => ({ gdKey, src, dst, normal })),
    roomDoors: Object.fromEntries(rooms.map((grKey) => [grKey, getRoomDoorKeys(w, grKey)])),
  } satisfies WW.JshMsgToNavWorker);
  setupMapKey.set(worker, setupKey);
}

function getRoomDoorKeys(w: JshCli.WorldState, grKey: Geomorph.GmRoomKey) {
  const node = w.gmRoomGraph.getNode(grKey);
  return node === null ? [] : w.gmRoomGraph.getSuccs(node).flatMap((succ) => (succ.type === "door" ? succ.gdKey : []));
}

function getWorker(w: JshCli.WorldState) {
  const worker = w.navWorker.worker;
  if (!(worker instanceof Worker)) throw Error("worker not ready"); // a stub swallows posts before it mounts
  return worker;
}

/** What each worker was last set up for: map and layout */
const setupMapKey = new WeakMap<Worker, string>();

/**
 * Everyone stood in the rooms of `npcs`: a spot on top of any of them is no spot at all. Keyed, so a room shared
 * by two of them is only sent once. The worker drops those being padded
 */
export function roomOthers(w: JshCli.WorldState, npcs: JshCli.Npc[]) {
  const others = new Map(
    npcs.flatMap((npc) => {
      const at = w.npc.npcToRoom.get(npc.key);
      if (at === undefined) return [];
      return [...(w.npc.roomToNpcs[at.gmId]?.[at.roomId] ?? [])].flatMap((key) => {
        const point = w.n[key]?.point;
        return point === undefined ? [] : [[key, { key, point, grKey: at.grKey }] as const];
      });
    }),
  );
  return [...others.values()];
}

/** Everyone parked, wherever: a handful, and the worker keeps to the rooms involved */
export function parkedNow(w: JshCli.WorldState) {
  return [...parked.get()].flatMap(([key, seg]) => {
    const grKey = w.npc.npcToRoom.get(key)?.grKey;
    const point = w.n[key]?.point; // persisted: they may not be here this time
    return grKey === undefined || point === undefined ? [] : [{ key, point, grKey, seg }];
  });
}
