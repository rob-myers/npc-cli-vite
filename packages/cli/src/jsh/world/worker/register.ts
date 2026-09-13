import { overrideWorkerFactory } from "@npc-cli/ui__world/world-worker-factory";

// the world worker is spawned from jsh's entry, which adds jsh's cases — see `jsh.worker.ts`.
// Imported by the app's entry, so it is set before any World mounts
overrideWorkerFactory(() => new Worker(new URL("./jsh.worker.ts", import.meta.url), { type: "module" }));
