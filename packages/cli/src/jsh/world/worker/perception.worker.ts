import { SegGrid } from "@npc-cli/ui__world/seg-grid";
import { answerSpotQueries, getSpots, setupSpots } from "./spots";

/**
 * The perception worker: the map's spots and what blocks sight, apart from the nav worker so neither
 * waits on the other — see `docs/workers.md`
 */
self.addEventListener("message", (e: MessageEvent<WW.PerceptionMsgTo>) => {
  const msg = e.data;
  switch (msg?.type) {
    case "perception-setup":
      setupSpots(msg);
      sight.grid = new SegGrid(1);
      for (const { a, b, kind, id, top } of msg.occluders) sight.grid.add([a, b], kind, id, top);
      sight.open = new Set(msg.openDoors);
      sight.doorRev++;
      break;
    case "perception-door":
      if (msg.open) sight.open.add(msg.gdKey);
      else sight.open.delete(msg.gdKey);
      sight.doorRev++;
      break;
    case "perception-query":
      void answer(msg);
      break;
  }
});

/** What blocks sight on the map last set up, the doors seen through, and how often those have changed */
const sight = { grid: new SegGrid(1), open: new Set<string>(), doorRev: 0 };

/** Always answers, else main waits forever */
async function answer({ uid, op }: Extract<WW.PerceptionMsgTo, { type: "perception-query" }>) {
  let output: WW.SpotAnswer[] = [];
  let error: undefined | string;
  try {
    output = answerSpotQueries(await getSpots(), op, sight);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  self.postMessage({ type: "perception-result", uid, output, error } satisfies WW.PerceptionMsgFrom);
}

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    self.postMessage({ type: "worker-hot-module-reload" } satisfies WW.PerceptionMsgFrom);
  });
}
