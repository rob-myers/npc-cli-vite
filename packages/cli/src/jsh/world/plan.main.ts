/// <reference path="./worker/jsh-worker.d.ts" />

import { parked } from "./pred";
import { ask, detachedUid, getRoomDoorKeys } from "./worker.main";

/**
 * One plan op on the nav worker, which `worker/jsh.worker.ts` extends, under the shell's pause/kill.
 * The ops are in `worker/plan.worker.ts`. Spots and sight: see `perception.main.ts`
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
  return post(w, detachedUid(), op, new AbortController().signal);
}

function post<O extends WW.JshOp>(w: JshCli.WorldState, uid: string, op: O, signal: AbortSignal) {
  return ask<WW.JshOutput[O["key"]]>(w, { type: "jsh-plan", uid, op }, signal);
}

export function isPaused(e: unknown) {
  return e instanceof Error && e.message === "paused";
}

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
