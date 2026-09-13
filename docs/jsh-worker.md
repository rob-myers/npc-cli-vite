# The jsh worker

Npc behaviour computations run off the main thread, on the world worker, and are owned by
`packages/cli` jsh rather than the world package. `park` was the first; `boundary`, `pad` and
`nudge` followed. See `packages/cli/src/jsh/world/worker/` and `plan.main.ts` beside it.

## Why

`park` planned where each npc should stand on the main thread: navcat's local boundary, minus
door frames and other parked npcs, then the nearest clear point — O(N·(D+N)²) per batch, paced by
a sleep per npc, blocking frames. More such behaviours are coming, so the computation moved to a
worker, as pure functions over plain geometry: points, circles, segments, and the navmesh.

## How it plugs in

The world worker (`packages/ui/world/src/worker/world.worker.ts`) is spawned by `WorldWorker`.
cli depends on world and not vice versa, so cli cannot be imported into that worker. Instead cli
owns the **entry** the world spawns:

- `worker/jsh.worker.ts` imports the world's listener, removes it, and registers one of its own
  that handles jsh's messages first and hands the rest on. It shares no main-thread world module
  — see the HMR note in `WorldWorker.tsx`.
- `worker/register.ts` gives that entry to `setWorldWorkerFactory` (world's
  `service/world-worker-factory.ts`). It is imported by the app's entry, `packages/app/src/main.tsx`,
  so it is set before any World mounts and only one worker is ever spawned. World's own
  `world.worker.ts` is the fallback, and its `default` case no longer sees jsh's messages.
- World keeps the navmesh it generates in its worker store (`navMesh`), and exports
  `./worker`, `./worker/store` and `./worker/nav-util` for the jsh side.

There is one thread: jsh's ops and the world's physics share it. A long op therefore `yield`s
between units of work, and the dispatcher turns each yield into an event-loop yield
(`scheduler.yield`, else a macrotask) so the physics queued behind it runs.

## The ops

`worker/types.d.ts` declares `JshWW.Op`, a discriminated union on `key`, each member carrying its
input; `JshWW.Output` says what each gives. `worker/plan.worker.ts` has one generator per key:

| op | input | output |
|---|---|---|
| `park` | `npcs: NpcQuery[]`, `parked` (everyone parked, with their seg) | a `ParkPlan` per npc, or `null` with no wall in reach |
| `boundary` | `npc` | the boundary segments within `parkQueryRange`, nearest first |
| `pad` | `npc`, `by` | a step of `by` off the nearest wall, along its inward normal |
| `nudge` | `npc`, `to` | `to`, slid along the navmesh under the npc's door filter |

`NpcQuery` is an npc as an op sees them: point, `nodeRef` (the corridor head, `w.npc.getNodeRef`;
looked up afresh if stale), room, and the doors they may not pass. The worker's query filter
refuses those door areas bar the one they stand on, as `Npc.canPassNode` does. There is no crowd
on the worker: one scratch `localBoundary.create()` is the "dummy agent".

Door frames and each room's door keys are sent once per map per worker (`jsh-setup`), by
`ensureSetup` before the first request. Door access is per request, so nothing goes stale.

## The client

`plan.main.ts`:

- `plan({ api, w, op })` — one op under the shell's pause/kill; the result type follows `op.key`.
- `npcQuery(w, npc)` — builds the `NpcQuery`.
- `request(w, api, op, signal)` — one message and its reply, matched by uid; rejects on the
  worker's `error` (e.g. `"no navmesh"` whilst the world is still generating it) or on abort.
- `awaitPausable(api, run)` — a kill aborts `run`'s signal with the kill error; a pause aborts it
  with `"paused"` and reruns once resumed. `run` decides what an abort interrupts: `park` lets a
  fade or look finish on a pause, since `npc.rejectAll` would zero the fade.

The commands stay where they were: `park`, `pad`, `nudge` in `core.ts`, `demo_local_boundary` in
`demo.ts` — which now draws exactly the segments `park` sees.

## Adding an op

1. A member of `JshWW.Op` and an entry in `JshWW.Output`.
2. A generator on `ops` in `plan.worker.ts`, `yield`ing wherever it can pause.
3. A caller: `await plan({ api, w, op: { key, ... } })`.

## Parked state

`w.e.parked` is set by `park` after the move and cleared when the npc starts moving or respawns —
an npc is parked only if it was explicitly parked, not by standing near a wall.
