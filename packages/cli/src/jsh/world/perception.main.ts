/// <reference path="./worker/jsh-worker.d.ts" />

import { spotsChangedEvent } from "@npc-cli/ui__world/spot.schema";
import { sightOccluders } from "@npc-cli/ui__world/spot-sight";
import { awaitPausable } from "./plan.main";

/*
 * The perception worker's side on main: spot and sight queries, the worker per World, its setup and door changes.
 * See `docs/perception.md`, and `worker/perception.worker.ts` for the other side
 */

/** Bumped as the dev server remakes the spot files, so the next query sets the perception worker up again */
let spotsRev = 0;
import.meta.hot?.on(spotsChangedEvent, () => void spotsRev++);

/**
 * A batch of spot queries, answered by the perception worker in one round trip, under the shell's pause/kill.
 * The npcs they name are snapshotted now — see `docs/perception.md`
 */
export function spotQuery(ct: Pick<JshCli.RunArg, "api" | "w">, queries: WW.SpotQuery[]) {
  return awaitPausable(ct.api, (signal) => perceive(ct.w, ct.api.getUid(), spotOp(ct.w, queries), signal));
}

/** As `spotQuery`, outside any process, e.g. from a keyed tick */
export function spotQueryDetached(w: JshCli.WorldState, queries: WW.SpotQuery[]) {
  return perceive(w, `detached-${++detachedUid}`, spotOp(w, queries), new AbortController().signal);
}

let detachedUid = 0;

function perceive(w: JshCli.WorldState, uid: string, op: WW.SpotsOp, signal: AbortSignal) {
  const p = getPerception(w);
  return new Promise<WW.SpotAnswer[]>((resolve, reject) => {
    signal.throwIfAborted();
    p.pending.set(uid, { resolve, reject });
    signal.addEventListener("abort", () => (p.pending.delete(uid), reject(signal.reason)), { once: true });
    p.worker.postMessage({ type: "perception-query", uid, op } satisfies WW.PerceptionMsgTo);
  });
}

/** `w`'s perception worker, made on first use and set up for its map, its spots and what blocks sight */
function getPerception(w: JshCli.WorldState) {
  let p = perceptions.get(w.key);
  // its World remounted, or this module reloaded: the old worker answers as the old code did
  if (p !== undefined && (p.w !== w || p.madeBy !== thisModule)) p.stop(), perceptions.delete(w.key), (p = undefined);
  if (p === undefined) perceptions.set(w.key, (p = startPerception(w)));
  const setupKey = `${w.mapKey} ${w.gmsHash} ${spotsRev}`;
  if (p.setupKey !== setupKey) {
    p.worker.postMessage({
      type: "perception-setup",
      mapKey: w.mapKey,
      gms: w.gms.map(({ key, transform }) => ({ key, transform })),
      spotsRev,
      occluders: sightOccluders(w.gms),
      openDoors: Object.keys(w.door.byKey).filter((gdKey) => w.door.isSeenThrough(gdKey as Geomorph.GmDoorKey)),
    } satisfies WW.PerceptionMsgTo);
    p.setupKey = setupKey;
  }
  return p;
}

function startPerception(w: JshCli.WorldState): Perception {
  const p: Perception = { w, madeBy: thisModule, worker: spawn(), setupKey: "", pending: new Map(), stop() {} };

  /** A worker answering `p.pending` by uid, respawned on its own HMR, or in DEV if it fails to load */
  function spawn() {
    const worker = new Worker(new URL("./worker/perception.worker.ts", import.meta.url), { type: "module" });
    let spoken = false;
    worker.addEventListener("message", ({ data }: MessageEvent<WW.PerceptionMsgFrom>) => {
      spoken = true;
      if (data?.type === "worker-hot-module-reload") return respawn();
      const pending = data?.type === "perception-result" ? p.pending.get(data.uid) : undefined;
      if (pending === undefined) return;
      p.pending.delete(data.uid);
      data.error === undefined ? pending.resolve(data.output) : pending.reject(Error(data.error));
    });
    worker.addEventListener("error", () => void (import.meta.hot && spoken === false && setTimeout(respawn, 2000)));
    return worker;
  }
  /** What was asked of the last is rejected, and the next query sets it up again */
  function respawn() {
    p.worker.terminate();
    for (const { reject } of p.pending.values()) reject(Error("perception restarted"));
    p.pending.clear();
    p.worker = spawn();
    p.setupKey = "";
  }

  const sub = w.events.subscribe({
    next(e) {
      if (e.key !== "door-opening" && e.key !== "door-closed") return;
      const open = e.key === "door-opening";
      p.worker.postMessage({ type: "perception-door", gdKey: e.gdKey, open } satisfies WW.PerceptionMsgTo);
    },
  });
  p.stop = () => (sub.unsubscribe(), p.worker.terminate());
  return p;
}

/** This module's evaluation: a worker made by another is replaced */
const thisModule = Symbol("perception.main");

/** By World key: on `globalThis`, so an HMR of this module does not orphan them */
const perceptions: Map<string, Perception> = ((
  globalThis as { __perceptions?: Map<string, Perception> }
).__perceptions ??= new Map());

type Perception = {
  w: JshCli.WorldState;
  madeBy: symbol;
  worker: Worker;
  /** What it was last set up for: map, layout and spots */
  setupKey: string;
  /** By uid, the queries awaiting an answer */
  pending: Map<string, { resolve(output: WW.SpotAnswer[]): void; reject(e: Error): void }>;
  /** Ends it, e.g. as its World remounts */
  stop(): void;
};

function spotOp(w: JshCli.WorldState, queries: WW.SpotQuery[]): WW.SpotsOp {
  const named = new Set(queries.flatMap(namedIn));
  const npcs = [...named].flatMap((key): WW.SpotNpc[] => {
    const npc = w.n[key];
    if (npc === undefined) return []; // a spot key
    const rooms = [w.npc.npcToRoom.get(key), ...(w.e.insideDoorways.get(key)?.rooms ?? [])];
    const grKeys = [...new Set(rooms.flatMap((room) => room?.grKey ?? []))];
    const posture = npc.anim.posture as WW.SpotNpc["posture"];
    const crouched = npc.anim.crouchLevel === 2;
    return [{ key, point: { x: npc.point.x, y: npc.point.y }, grKeys, posture, crouched }];
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
      return [q.npc, ...q.from];
    case "makeWay":
      return [q.npc];
  }
}
