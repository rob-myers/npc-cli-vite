import { Worker } from "node:worker_threads";
import type { PairOutcome, PairsJob, PairsJudge } from "@npc-cli/ui__world/spot-sight";

/**
 * Threads judging spot pairs for `computeSpots`, its slowest part — see `docs/spots.md`.
 * Rows are dealt out in turn, so each thread gets early rows, which have the most pairs, and late ones alike
 */
export function createSightPool(size: number) {
  const workers = Array.from({ length: size }, () => new Worker(bootstrap, { eval: true }));

  const judge: PairsJudge = async (job) => {
    const rows = workers.map((_, w) => [...job.spots.keys()].filter((i) => i % size === w));
    const parts = await Promise.all(workers.map((worker, w) => ask(worker, job, rows[w])));
    return parts.flat();
  };

  return {
    judge,
    close: () => Promise.all(workers.map((worker) => worker.terminate())),
  };
}

/** A thread's first code: `--import=tsx` reaches no thread, so it registers `tsx` itself, then loads the worker */
const bootstrap = `import("tsx/esm/api").then(({ register }) => {
  register();
  return import(${JSON.stringify(new URL("./sight-pool.worker.ts", import.meta.url).href)});
});`;

/** One job's rows, posted to `worker` and answered */
function ask(worker: Worker, job: PairsJob, rows: number[]) {
  return new Promise<PairOutcome[]>((resolve, reject) => {
    const onMessage = (outcomes: PairOutcome[]) => (worker.off("error", onError), resolve(outcomes));
    const onError = (e: Error) => (worker.off("message", onMessage), reject(e));
    worker.once("message", onMessage);
    worker.once("error", onError);
    worker.postMessage({ job, rows });
  });
}
