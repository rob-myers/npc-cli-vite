/**
 * Worker with entrypoint `world.worker.ts` would work, but
 * we'll actually use entrypoint `jsh.worker.ts` spawned from app package.
 * The latter imports world.worker.ts.
 */

let factory = () => new Worker(new URL("../worker/world.worker.ts", import.meta.url), { type: "module" });

export function overrideWorkerFactory(next: () => Worker) {
  factory = next;
}

export function ensureWorldWorker() {
  return factory();
}
