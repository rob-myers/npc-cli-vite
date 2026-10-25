/// <reference path="./worker/jsh-worker.d.ts" />

import { spotsChangedEvent } from "@npc-cli/ui__world/spot.schema";
import { sightOccluders } from "@npc-cli/ui__world/spot-sight";

/*
 * jsh's side of the World's nav worker, which `worker/jsh.worker.ts` extends: its requests, the map
 * setup before them, and the doors as they change. See `docs/workers.md`
 */

/** Bumped as the dev server remakes the spot files, so the next request sets the worker up again */
let spotsRev = 0;
import.meta.hot?.on(spotsChangedEvent, () => void spotsRev++);

/** Which remaking of the spot files is current, e.g. to redraw them */
export const getSpotsRev = () => spotsRev;

/** One request, after the map setup if need be: its reply's `output`, else it rejects */
export function ask<T>(w: JshCli.WorldState, msg: WW.JshRequest | WW.PerceptionQuery, signal: AbortSignal) {
  const worker = w.navWorker.worker;
  // a stub swallows posts before it mounts
  if (!(worker instanceof Worker)) return Promise.reject<T>(Error("worker not ready"));
  ensureSetup(w, worker);
  ensureDoorFeed(w);
  return w.navWorker.request(msg, signal) as Promise<T>;
}

/** A uid for a request from no process */
export const detachedUid = () => `detached-${++detached}`;
let detached = 0;

export function getRoomDoorKeys(w: JshCli.WorldState, grKey: Geomorph.GmRoomKey) {
  const node = w.gmRoomGraph.getNode(grKey);
  return node === null ? [] : w.gmRoomGraph.getSuccs(node).flatMap((succ) => (succ.type === "door" ? succ.gdKey : []));
}

/** Sends `worker` the map whole, once per map, layout and spots */
function ensureSetup(w: JshCli.WorldState, worker: Worker) {
  const setupKey = `${w.mapKey} ${w.gmsHash} ${spotsRev}`;
  if (setupKeys.get(worker) === setupKey) return;
  const rooms = w.gmRoomGraph.nodesArray.flatMap((node) => (node.type === "room" ? node.grKey : []));
  worker.postMessage({
    type: "jsh-setup",
    mapKey: w.mapKey,
    doorFrames: Object.values(w.d).map(({ gdKey, src, dst, normal }) => ({ gdKey, src, dst, normal })),
    roomDoors: Object.fromEntries(rooms.map((grKey) => [grKey, getRoomDoorKeys(w, grKey)])),
    gms: w.gms.map(({ key, transform }) => ({ key, transform })),
    spotsRev,
    occluders: sightOccluders(w.gms),
    openDoors: Object.keys(w.door.byKey).filter((gdKey) => w.door.isSeenThrough(gdKey as Geomorph.GmDoorKey)),
    doableKeys: Object.fromEntries(
      w.gms.flatMap((gm, gmId) =>
        gm.decor.flatMap((d, decorId) =>
          d.type === "point" && typeof d.meta.do === "string" && d.key !== undefined
            ? [[`${gmId}/${decorId}`, d.key]]
            : [],
        ),
      ),
    ),
    hullPairs: w.gms.flatMap((gm, gmId) =>
      gm.hullDoors.flatMap((_, doorId): [string, string][] => {
        const adj = w.gmGraph.getAdjacentRoomCtxt(gmId, doorId);
        return adj === null ? [] : [[`g${gmId}d${doorId}`, adj.adjGdKey]];
      }),
    ),
  } satisfies WW.JshSetup);
  setupKeys.set(worker, setupKey);
}

/** What each worker was last set up for: a respawned one is set up again */
const setupKeys = new WeakMap<Worker, string>();

/** Tells whichever worker is current of each door seen through or shut, from `w`'s first request on */
function ensureDoorFeed(w: JshCli.WorldState) {
  const feed = doorFeeds.get(w);
  if (feed?.madeBy === thisModule) return;
  feed?.sub.unsubscribe();
  const sub = w.events.subscribe({
    next(e) {
      if (e.key !== "door-opening" && e.key !== "door-closed") return;
      const open = e.key === "door-opening";
      w.navWorker.worker.postMessage({ type: "perception-door", gdKey: e.gdKey, open } satisfies WW.PerceptionMsgTo);
    },
  });
  doorFeeds.set(w, { madeBy: thisModule, sub });
}

/** This module's evaluation: a feed made by another is replaced */
const thisModule = Symbol("worker.main");

/** By World: on `globalThis`, so an HMR of this module does not leave a second feed */
const doorFeeds = ((globalThis as { __jshDoorFeeds?: DoorFeeds }).__jshDoorFeeds ??= new WeakMap());

type DoorFeeds = WeakMap<JshCli.WorldState, { madeBy: symbol; sub: { unsubscribe(): void } }>;
