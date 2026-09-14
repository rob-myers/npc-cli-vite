/**
 * Spawns the nav worker. Another package may spawn an entry that wraps ours instead — see
 * `jsh.worker.ts` in `@npc-cli/cli`, registered from the app's entry so it is set before any World
 * mounts. The physics worker has no such hook
 */
let factory = () => new Worker(new URL("../worker/nav.worker.ts", import.meta.url), { type: "module" });

export function overrideNavWorkerFactory(next: () => Worker) {
  factory = next;
}

export function ensureNavWorker() {
  return factory();
}
