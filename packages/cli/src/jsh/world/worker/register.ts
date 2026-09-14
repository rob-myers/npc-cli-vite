import { overrideNavWorkerFactory } from "@npc-cli/ui__world/nav-worker-factory";

// the world's nav.worker is spawned from jsh's entry, adds jsh's cases — see `jsh.worker.ts`.
overrideNavWorkerFactory(() => new Worker(new URL("./jsh.worker.ts", import.meta.url), { type: "module" }));
