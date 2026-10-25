/// <reference path="./worker/jsh-worker.d.ts" />

import { awaitPausable } from "./plan.main";
import { ask, detachedUid } from "./worker.main";

/*
 * Spot and sight queries, answered by the nav worker's perception side — see `docs/perception.md`,
 * and `worker/handle-perception.ts` for the other side
 */

/**
 * A batch of spot queries, answered in one round trip, under the shell's pause/kill.
 * The npcs they name are snapshotted now — see `docs/perception.md`
 */
export function spotQuery(ct: Pick<JshCli.RunArg, "api" | "w">, queries: WW.SpotQuery[]) {
  return awaitPausable(ct.api, (signal) => perceive(ct.w, ct.api.getUid(), spotOp(ct.w, queries), signal));
}

/** As `spotQuery`, outside any process, e.g. from a keyed tick */
export function spotQueryDetached(w: JshCli.WorldState, queries: WW.SpotQuery[]) {
  return perceive(w, detachedUid(), spotOp(w, queries), new AbortController().signal);
}

function perceive(w: JshCli.WorldState, uid: string, op: WW.SpotsOp, signal: AbortSignal) {
  return ask<WW.SpotAnswer[]>(w, { type: "perception-query", uid, op }, signal);
}

/** An npc's eyes on the front of their head as last posed, else above their point */
function eyeOf(npc: JshCli.WorldState["n"][string]): WW.SpotNpc["eye"] {
  const e = npc.anim.upperHead.entry?.bone.matrixWorld.elements;
  if (e === undefined) return { x: npc.point.x, y: npc.point.y, h: 1.37 };
  const { up, ahead } = eyeAt;
  // the bone's origin, then its y and z columns
  return {
    x: e[12] + e[4] * up + e[8] * ahead,
    y: e[14] + e[6] * up + e[10] * ahead,
    h: e[13] + e[5] * up + e[9] * ahead,
  };
}
/** Where the eyes are in the head bone's own units, from the neck: up it, and out to the face, as the model faces its -z */
const eyeAt = { up: 0.19, ahead: -0.23 };

function spotOp(w: JshCli.WorldState, queries: WW.SpotQuery[]): WW.SpotsOp {
  const named = new Set(queries.flatMap(namedIn));
  const npcs = [...named].flatMap((key): WW.SpotNpc[] => {
    const npc = w.n[key];
    if (npc === undefined) return []; // a spot key
    const rooms = [w.npc.npcToRoom.get(key), ...(w.e.insideDoorways.get(key)?.rooms ?? [])];
    const grKeys = [...new Set(rooms.flatMap((room) => room?.grKey ?? []))];
    const posture = npc.anim.posture as WW.SpotNpc["posture"];
    const crouched = npc.anim.crouchLevel === 2;
    const seeRooms = [...new Set(grKeys.flatMap((grKey) => w.e.roomsInView(grKey).map((room) => room.grKey)))];
    const doable = w.decor.byKey[w.npc.npcToDoable[key] ?? ""];
    const doAt = posture !== "stand" && doable?.type === "point" ? { x: doable.x, y: doable.y } : undefined;
    const at = { x: npc.point.x, y: npc.point.y };
    return [{ key, point: at, grKeys, posture, crouched, seeRooms, doAt, eye: eyeOf(npc) }];
  });
  return { npcs, queries };
}

/** The keys a query names, npcs among them */
function namedIn(q: WW.SpotQuery): string[] {
  switch (q.q) {
    case "of":
      return [q.npc];
    case "get":
      return [];
    case "list":
      return q.near === undefined ? [] : [q.near.npc];
    case "sees":
      return [q.a, q.b];
    case "seenBy":
      return [q.a];
    case "at":
      return [];
    case "hide":
    case "hidden":
      return [q.npc, ...q.from];
    case "makeWay":
      return [q.npc];
    case "view":
      return [q.from];
    case "explain":
      return [q.a, q.b];
  }
}
