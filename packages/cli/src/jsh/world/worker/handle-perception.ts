import { SegGrid } from "@npc-cli/ui__world/seg-grid";
import { answerSpotQueries, getSpots, setupSpots } from "./spots";

/** What blocks sight on the map last set up, the doors seen through, and how often those have changed */
const sight = { grid: new SegGrid(1), open: new Set<string>(), doorRev: 0 };

export function setupPerception(msg: WW.JshSetup) {
  setupSpots(msg);
  sight.grid = new SegGrid(1);
  for (const { a, b, kind, id, top } of msg.occluders) sight.grid.add([a, b], kind, id, top);
  sight.open = new Set(msg.openDoors);
  sight.doorRev++;
}

export function setDoorSeenThrough({ gdKey, open }: Extract<WW.PerceptionMsgTo, { type: "perception-door" }>) {
  if (open) sight.open.add(gdKey);
  else sight.open.delete(gdKey);
  sight.doorRev++;
}

/** Always answers, else main waits forever */
export async function answerPerception({ uid, op }: WW.PerceptionQuery) {
  let output: WW.SpotAnswer[] = [];
  let error: undefined | string;
  try {
    output = answerSpotQueries(await getSpots(), op, sight);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  self.postMessage({ type: "perception-result", uid, output, error } satisfies WW.PerceptionMsgFrom);
}
