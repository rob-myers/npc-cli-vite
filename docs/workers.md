# Workers

Two web workers, under `packages/ui/world/src/worker/`, each owned by a component in
`packages/ui/world/src/components/`:

| worker | thread's job | owner | handle |
|---|---|---|---|
| `physics.worker.ts` | rapier: npc bodies stepped on the positions sent each tick, door sensors, decor colliders | `PhysicsWorker` | `w.physics` |
| `nav.worker.ts` | navmesh generation, the room graph and its reachability query, raycasts, and jsh's ops | `NavWorker` | `w.navWorker` |

They were one worker. Split so nav work and jsh's ops never stall the physics step, and so each
bundle carries only its own library: rapier in one, navcat and `detect-collisions` in the other.
`w.nav` is the navmesh response the nav worker last sent, not the worker.

Messages are typed in `world-worker.d.ts` (`WW.MsgToWorker` / `MsgFromWorker` for physics,
`WW.MsgToNavWorker` / `MsgFromNavWorker` for nav), and jsh's in `packages/cli`'s
`jsh-worker.d.ts`, merged into the same namespace. Payloads are crafted plain data
(`service/worker-data.ts`): the workers must share no module with the main thread, else an hmr
of e.g. `const.env.ts` reloads the page. Constants a worker needs are typed copies.

## The jsh plug-in

Npc behaviour computations — `park` first; `boundary`, `pad` and `nudge` since — run on the nav
worker but are owned by `packages/cli` jsh, under `src/jsh/world/worker/`. cli depends on world
and not vice versa, so cli cannot be imported into that worker. Instead cli owns the **entry**
the world spawns:

- `jsh.worker.ts` imports the nav worker's listener, removes it, and registers one of its own that
  handles jsh's messages first and hands the rest on.
- `register.ts` gives that entry to `overrideNavWorkerFactory` (world's
  `service/nav-worker-factory.ts`). It is imported by the app's entry, `packages/app/src/main.tsx`,
  so it is set before any World mounts and only one nav worker is ever spawned. World's own
  `nav.worker.ts` is the fallback; `NavWorker`'s `default` case lets jsh's replies pass.
- The nav worker keeps the navmesh it generates (`getNavMesh`); world exports `./worker/nav`,
  `./worker/nav-util` and `./nav-worker-factory` for the jsh side.

### The ops

`jsh-worker.d.ts` declares `WW.JshOp`, a discriminated union on `key`, each member carrying its
input; `WW.JshOutput` says what each gives. `plan.worker.ts` has one function per key — plain,
async, or a generator — all driven the same way by `handle-message.ts`:

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

A generator op's every `yield` is a breath: the dispatcher turns it into an event-loop yield
(`scheduler.yield`, else a macrotask), so e.g. a raycast queued behind a long op runs. `park`
yields per npc.

### The client

`plan.main.ts`:

- `plan({ api, w, op })` — one op under the shell's pause/kill; the result type follows `op.key`.
- `npcQuery(w, npc)` — builds the `NpcQuery`.
- `request(w, api, op, signal)` — one message and its reply, matched by uid; rejects on the
  worker's `error` or on abort.
- `awaitPausable(api, run)` — a kill aborts `run`'s signal with the kill error; a pause aborts it
  with `"paused"` and reruns once resumed. `run` decides what an abort interrupts: `park` lets a
  fade or look finish on a pause, since `npc.rejectAll` would zero the fade.

The commands stay in place: `park`, `pad`, `nudge` in `core.ts`, `demo_boundary` in
`demo.ts`, which draws exactly the segments `park` sees. To add an op: a member of `WW.JshOp`, an
entry in `WW.JshOutput`, a function on `ops`, and a caller `plan({ api, w, op: { key, ... } })`.

`w.e.parked` is set by `park` after the move and cleared when the npc starts moving or respawns —
an npc is parked only if it was explicitly parked.

## Stability

- **Every request is answered.** A worker replies even on failure: `request-unreachable` answers
  "reachable", `jsh-plan` answers `error` (e.g. `"no navmesh"` whilst the nav worker is still
  generating it), so nothing on main waits on a promise nothing can resolve.
- **Teardown rejects what is pending.** `NavWorker` rejects `pendingUnreachable` and
  `pendingRaycast` with "worker terminated"; `PhysicsWorker` releases pending `settle`s. A map
  change rejects with "map changed".
- **HMR is per worker.** Each owner has its own `reloads`, bumped by its worker's
  `worker-hot-module-reload`; editing nav code respawns and re-requests the navmesh and room
  graph, leaving the physics bodies alone, and vice versa. `setup-physics` carries the full npc and
  collider snapshot so a physics respawn rebuilds its world.
- **A worker that fails to load is retried** (`use-worker-load-retry.ts`, dev only). A syntax
  error saved at the wrong moment spawns a worker whose module never loads: it never speaks, and
  has no hmr client to hear the fix. One that errors before speaking is respawned every 2s until
  it comes up. Manual respawn: `w navWorker.set '{ reloads: 5 }'` (any new value).
- **Setup is per worker instance.** jsh's `ensureSetup` keys its map setup by `Worker`, so a
  respawned nav worker is set up again before its first request.
- **`settle` is physics'.** `openDoorwaysWithNpcs` awaits `w.physics.settle()`, a ping whose pong
  arrives after everything posted before it: the collider events it needs are in by then.
- **Ordering.** Physics setup no longer queues behind navmesh generation, so physics may be ready
  first. Nothing depends on the order today (`requested-physics` → room relationships,
  `nav-updated` → `warmCrowd`).
