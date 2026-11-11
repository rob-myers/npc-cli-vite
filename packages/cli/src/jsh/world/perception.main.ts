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
  return awaitPausable(ct.api, (signal) => askWorker(ct.w, ct.api.getUid(), spotOp(ct.w, queries), signal));
}

/** Each spot's point by key or alias, else `null` where none is. No query if `keys` is empty */
export async function spotPoints(ct: Pick<JshCli.RunArg, "api" | "w">, keys: string[]) {
  const answers =
    keys.length === 0
      ? []
      : await spotQuery(
          ct,
          keys.map((key) => ({ q: "get", key })),
        );
  return answers.map((spot) => (isSpot(spot) ? { x: spot.x, y: spot.y } : null));
}

export function isSpot(answer: undefined | WW.SpotAnswer): answer is WW.SpotJson {
  return answer != null && !Array.isArray(answer) && "x" in answer;
}

/** As `spotQuery`, outside any process, e.g. from a keyed tick */
export function spotQueryDetached(w: JshCli.WorldState, queries: WW.SpotQuery[]) {
  return askWorker(w, detachedUid(), spotOp(w, queries), new AbortController().signal);
}

function askWorker(w: JshCli.WorldState, uid: string, op: WW.SpotsOp, signal: AbortSignal) {
  return ask<WW.SpotAnswer[]>(w, { type: "perception-query", uid, op }, signal);
}

/**
 * The pairs whose first sees the second: eyes open, within `sightHalfArc` of where their head faces, then in sight.
 * The worker decides the last, e.g. a low obstacle hiding one crouched. `los` asks only that
 */
export async function perceive(ct: Pick<JshCli.RunArg, "api" | "w">, pairs: [string, string][], los: boolean) {
  const facing = pairs.filter(([a, b]) => los || unfaced(ct.w, a, b) === null);
  if (facing.length === 0) return [];
  const answers = await spotQuery(
    ct,
    facing.map(([a, b]) => ({ q: "sees", a, b })),
  );
  return facing.filter((_, i) => {
    const x = answers[i];
    return x != null && "crouchHides" in x && x.sees;
  });
}

/** Why npc `a` cannot see `b` for their eyes or the way their head faces, else `null` */
export function unfaced(w: JshCli.WorldState, a: string, b: string) {
  const [watcher, seen] = [w.n[a], w.n[b]];
  if (watcher.anim.eyes.look === "shut") return "eyes shut";
  const off = watcher.anim.bearingOf(seen.point) - watcher.lookY; // the head's way, e.g. sat and turned
  return Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) <= sightHalfArc ? null : "fov";
}

/** Radians either side of where their head faces that an npc sees */
const sightHalfArc = Math.PI / 3;

/** An npc's eyes on the front of their head, and its centre, as last posed. Else both above their point */
function headOf(npc: JshCli.WorldState["n"][string]): Pick<WW.SpotNpc, "eye" | "head"> {
  const e = npc.anim.upperHead.entry?.bone.matrixWorld.elements;
  if (e === undefined) {
    const above = { x: npc.point.x, y: npc.point.y, h: 1.37 };
    return { eye: above, head: above };
  }
  // the bone's origin, then its y and z columns
  const through = ({ up, ahead }: typeof eyeAt) => ({
    x: e[12] + e[4] * up + e[8] * ahead,
    y: e[14] + e[6] * up + e[10] * ahead,
    h: e[13] + e[5] * up + e[9] * ahead,
  });
  return { eye: through(eyeAt), head: through(headAt) };
}
/** Where the eyes are in the head bone's own units, from the neck: up it, and out to the face, as the model faces its -z */
const eyeAt = { up: 0.19, ahead: -0.23 };
/** The centre of the head's box, in the same units */
const headAt = { up: 0.17, ahead: -0.015 };

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
    return [{ key, point: at, grKeys, posture, crouched, seeRooms, doAt, ...headOf(npc) }];
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
    case "view":
      return [q.from];
    case "explain":
      return [q.a, q.b];
  }
}
