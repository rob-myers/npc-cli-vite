# Workers

Two web workers live under `packages/ui/world/src/worker/`. Each is owned by a component in
`packages/ui/world/src/components/`.

| worker | its job | owner | handle |
|---|---|---|---|
| `physics.worker.ts` | rapier: npc bodies, door sensors, decor colliders | `PhysicsWorker` | `w.physics` |
| `nav.worker.ts`, two copies | the navmesh, the room graph and its reachability query, raycasts; jsh's plan ops and perception via `jsh.worker.ts` | `NavWorker` | `w.navWorker`, jsh's `worker.main.ts` |

`w.nav` is the navmesh response the nav worker last sent. It is not the worker.

## Two copies of the nav worker

`NavWorker` spawns the same bundle twice (`w.navWorker.workers`), so quick answers never wait behind
long work:

- **`bulk`** makes the navmesh, and runs `park`, `pad`, and spot batches with `hide`, `hidden`,
  `list` or `view`;
- **`fast`** answers rays, `request-unreachable`, `boundary`, `nudge`, and every other spot batch:
  `sees`, `explain`, `makeWay`...

`w.navWorker.post(msg, role?)` sends to one copy, or to both. `request(msg, signal, role)` awaits a
reply from one. jsh's `ask` picks the role (`roleOf` in `worker.main.ts`).

- **Both get** the room graph, door changes (`perception-door`), and jsh's setup, each on its first
  request.
- **Only `fast` gets** the ray statics (`set-raycast-statics`), doors and their ratios, and shields.
- **The navmesh.** `bulk` makes it. Main sends it on to `fast` (`set-navmesh`) as it arrives. Rays
  answer meanwhile: generating one for `101+edges` takes about 670 ms, whilst a ray answers in about
  50 ms of `fast` starting (it waited about 690 ms with one worker).

## Why two

They were once one worker. Splitting them means:

- nav work and jsh's ops never stall the physics step;
- each bundle carries only its own library: rapier in one, navcat in the other.

## Messages and payloads

- **Types.** Physics messages are `WW.MsgToWorker` / `MsgFromWorker`, and nav's are
  `WW.MsgToNavWorker` / `MsgFromNavWorker`, all in `world-worker.d.ts`. jsh's are in `packages/cli`'s
  `jsh-worker.d.ts`, merged into the same namespace.
- **Plain data.** Payloads are crafted plain data (`service/worker-data.ts`). A worker must share no
  module with the main thread, else an hmr of e.g. `const.env.ts` reloads the page.
- **Constants.** Those a worker needs are typed copies, for the same reason.

## Physics: npc bodies and sensors

- **Each tick** the npcs' positions are sent (`send-npc-positions`), and the worker steps.
- **Bodies.** An npc's body is kinematic. Every sensor, a door's or a decor collider's, is fixed.
- **Moving a body** uses `setNextKinematicTranslation`, never `setTranslation`. A teleport fights the
  body's pending next position, and its sensor events go missing.
- **`stepWorld` steps twice.** Rapier finds contacts before it moves its bodies, so one step reports
  where they were. With one step, an npc respawned into a collider got no `enter-collider` until
  they next moved.
- **A new body is made 1000 below and moved in** (`add-physics-npcs`), then stepped. A body made
  inside a sensor never enters it. Someone seated has no body, so a spawn off a chair into a doorway
  left the door shut.

## The jsh plug-in

Npc behaviour computations run on the nav worker: `park` first, then `boundary`, `pad` and `nudge`.
They are owned by `packages/cli`'s jsh, under `src/jsh/world/worker/`.

cli depends on world, not the other way round, so world's worker cannot import cli. Instead cli owns
the **entry** the world spawns:

- **`jsh.worker.ts`** imports the nav worker's listener and removes it. It registers its own, which
  handles jsh's messages first and hands the rest on: plan ops (`handle-message.ts`) and perception
  (`handle-perception.ts`).
- **`register.ts`** gives that entry to `overrideNavWorkerFactory` (world's
  `service/nav-worker-factory.ts`).
  - The app's entry, `packages/app/src/main.tsx`, imports it. So it is set before any World mounts,
    and only one nav worker is ever spawned.
  - World's own `nav.worker.ts` is the fallback.
- **Requests.** `w.navWorker.request(msg, signal, role)` posts one with a `uid`. `NavWorker`'s `default`
  case settles it from the reply with that `uid`: its `output`, else its `error`.
- **The navmesh.** The nav worker keeps the one it generates (`getNavMesh`). World exports
  `./worker/nav`, `./worker/nav-util` and `./nav-worker-factory` for the jsh side.

### The ops

`jsh-worker.d.ts` declares `WW.JshOp`, a union on `key` whose members carry their input.
`WW.JshOutput` says what each op gives. `plan.worker.ts` has one function per key: plain, async or
a generator. `handle-message.ts` drives them all the same way.

| op | input | output |
|---|---|---|
| `park` | `npcs: NpcQuery[]`, `parked` (everyone parked, with their seg) | a `ParkPlan` per npc, or `null` with no wall in reach |
| `boundary` | `npc` | the boundary segments within `parkQueryRange`, nearest first |
| `pad` | `npc`, `by` | a step of `by` off the nearest wall, along its inward normal |
| `nudge` | `npc`, `to` | `to`, slid along the navmesh under the npc's door filter |

**`NpcQuery`** is an npc as an op sees them:

- their point;
- their `nodeRef`, the corridor head (`w.npc.getNodeRef`), looked up afresh if stale;
- their room;
- the doors they may not pass. The worker's query filter refuses those door areas, bar the one they
  stand on, as `Npc.canPassNode` does.

**The boundary.** There is no crowd on the worker. Its boundary is not navcat's local boundary,
which keeps only the 8 nearest segments: from a doorway, those are all its frame. `queryBoundary`
keeps every wall in range.

**Setup.** One `jsh-setup` per worker, map, layout and spots rev serves plan ops and perception.
`ensureSetup` in `worker.main.ts` sends it before the first request. It holds door frames, each
room's door keys, and what perception needs (`docs/perception.md`). Door access is sent per request,
so nothing goes stale.

**Yields.** Every `yield` of a generator op is a breath. The dispatcher turns it into an event-loop
yield (`scheduler.yield`, else a macrotask), so e.g. a raycast queued behind a long op still runs.
`park` yields once per npc.

### The client

`worker.main.ts` sends every jsh request (`ask`), setting the worker up first, and feeds it door
changes. `plan.main.ts` exports:

- **`plan({ api, w, op })`** runs one op under the shell's pause and kill. Its result type follows
  `op.key`.
- **`npcQuery(w, npc)`** builds the `NpcQuery`.
- **`request(w, api, op, signal)`** sends one message and awaits its reply, matched by uid. It
  rejects on the worker's `error`, or on abort.
- **`awaitPausable(api, run)`** handles pause and kill.
  - A kill aborts `run`'s signal with the kill error.
  - A pause aborts it with `"paused"`, and reruns it once resumed.
  - `run` decides what an abort interrupts. `park` lets a fade or look finish on a pause, since
    `npc.rejectAll` would zero the fade.

The commands stay where they were: `park`, `pad` and `nudge` in `core.ts`, and `demo_boundary` in
`demo.ts`, which draws exactly the segments `park` sees.

**To add an op:** add a member of `WW.JshOp`, an entry in `WW.JshOutput` and a function on `ops`.
Then call it with `plan({ api, w, op: { key, ... } })`.

**Parked npcs.** `park` marks them (`parked.mark` in `pred.ts`) after the move. A move or respawn clears it, so an npc is
parked only if it was explicitly parked.

## Raycasts

`w.e.raycast(src, dst)` is one request (`get-raycast`). `worker/ray-cast.ts` walks a world-space
`SegGrid` (`service/seg-grid.ts`) along it, every crossing nearest first.

- **What it holds.** Walls, door centre lines, and the edges of every obstacle above the floor. Walls
  and obstacles come per map (`set-raycast-statics`, in each geomorph's own coords). Doors come
  from `Doors` (`set-raycast-doors`): on each build, and to a fresh worker.
- **What stops it.** A wall, or a door crossed outside its gap. The gap grows from one end by the
  door's open ratio (`gapAtHighLambda`). `Doors.onTick` posts the ratios that changed
  (`set-door-ratios`), so only whilst a door moves.
- **What it names.** The doors it passed and the rooms beyond, `src`'s first. The obstacles and shields
  it met before stopping, nearest first. Not an obstacle it starts inside, e.g. a seat.
- **Hull doors.** Both records of one are in the grid, each with its own ratio. A ray crosses as many
  geomorphs as it reaches.
- **Shields** (`set-raycast-shields`) are a short list, tested edge by edge: few, and only rays count them.

The grid is apart from perception's sight grid. Sight keeps only what blocks it, and decides doors by
seen-through, not by ratio.

## Perception

Spots and sight, answered on the nav worker, have their own doc: `docs/perception.md`.

## Stability

- **Every request is answered.** A worker replies even on failure, so nothing on main waits on a
  promise nothing can resolve.
  - `request-unreachable` answers "reachable".
  - `jsh-plan` answers `error`, e.g. `"no navmesh"` whilst the nav worker is still generating it.
  - `get-raycast` answers `error` if the ray throws.
- **Teardown rejects what is pending.**
  - `NavWorker` rejects `pendingUnreachable` and its `pending` requests (rays, jsh's) with "worker
    terminated".
  - `PhysicsWorker` releases pending `settle`s.
  - A map change rejects with "map changed".
- **HMR is per worker.** Each owner has its own `reloads`, bumped by its worker's
  `worker-hot-module-reload`.
  - Editing nav code respawns both nav copies, which re-request the navmesh and room graph. The
    physics bodies are left alone, and vice versa.
  - Both copies post `worker-hot-module-reload`. Only `bulk`'s respawns the pair.
  - Editing jsh's worker code alone (`jsh.worker.ts` accepts it) reloads with `keepNavMesh`. The
    respawned pair is sent main's `w.nav.navMesh` (`set-navmesh`) instead of making it again.
    `nav-updated` is not emitted.
  - `setup-physics` carries the full npc and collider snapshot, so a respawned physics worker
    rebuilds its world.
- **A worker that fails to load is retried** (`use-worker-load-retry.ts`, dev only).
  - A syntax error saved at the wrong moment spawns a worker whose module never loads. It never
    speaks, and has no hmr client to hear the fix.
  - One that errors before speaking is respawned every 2s until it comes up, with its pair.
  - To respawn by hand: `w navWorker.set '{ reloads: 5 }'` (any new value).
- **Setup is per worker instance.** jsh's `ensureSetup` keys its map setup by `Worker`, so a
  respawned nav worker is set up again before its first request.
- **`settle` belongs to physics.** `openDoorwaysWithNpcs` awaits `w.physics.settle()`, a ping. Its
  pong arrives after everything posted before it, so the collider events it needs are in by then.
- **Ordering.** Physics setup no longer queues behind navmesh generation, so physics may be ready
  first. Nothing depends on the order today (`requested-physics` → room relationships, `nav-updated`
  → `warmCrowd`).
- **Keep worker modules disjoint** from the rest of `ui/world`. A module both import makes vite HMR
  fire more than once, which breaks worker re-initialisation.
