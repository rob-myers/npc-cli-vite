import { parentPort } from "node:worker_threads";
import { SegGrid } from "@npc-cli/ui__world/seg-grid";
import { judgePairs, type PairsJob } from "@npc-cli/ui__world/spot-sight";

/** One of `createSightPool`'s threads: judges the rows it is given of a job */
parentPort?.on("message", ({ job, rows }: { job: PairsJob; rows: number[] }) => {
  parentPort?.postMessage(judgePairs(job, SegGrid.of(1, job.occluders), rows));
});
