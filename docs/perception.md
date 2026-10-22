# Perception

The perception worker answers spot and sight queries: where npcs might stand, and who sees whom. It runs apart from the nav worker, so neither waits on the other, and editing spot code never regenerates the navmesh.

| Side | File | What |
| --- | --- | --- |
| main | `packages/cli/src/jsh/world/perception.main.ts` | `spotQuery`, `spotQueryDetached`; the worker per World, its setup and door changes |
| worker | `packages/cli/src/jsh/world/worker/perception.worker.ts` | messages in and out |
| worker | `packages/cli/src/jsh/world/worker/spots.ts` | the map's spots, and `answerSpotQueries` |
| shared | `packages/ui/world/src/service/spot-sight.ts` | what blocks sight (`sightOccluders`), and how the static lists are made |

The nav worker's own jsh side, the plan ops (`park`, `pad`, `nudge`, `boundary`), is separate: `plan.main.ts` on main, `worker/plan.worker.ts` there. See `docs/workers.md`.

## Queries

`spotQuery(ct, queries)` sends a batch in one round trip, under the shell's pause and kill (`awaitPausable`). `spotQueryDetached(w, queries)` does the same from no process, e.g. sidestep's keyed tick.

- **The npcs a batch names** are snapshotted as it is sent: their point, and their rooms (both sides in a doorway).
- **The queries** (`WW.SpotQuery` in `jsh-worker.d.ts`): `of`, `get`, `list`, `sees`, `seenBy`, `at`, `hide` and `makeWay`.
- **Callers**: `act.ts`, `spot.ts` (jsh `spots`, `spot`, `sees`) and `sidestep.ts`.

## The worker's life

- **Made lazily** by the first query, one per World. They are kept on `globalThis` by `w.key`, so an hmr of `perception.main.ts` does not orphan one. A remounted World gets a fresh one.
- **Set up** (`perception-setup`) per map, layout and spots rev:
  - the geomorphs, whose spot files it fetches (`public/spot/{gmKey}.json`, none for a playground);
  - what blocks sight (`sightOccluders`);
  - the doors seen through.
- **Doors** are told as they change (`perception-door`): open on `door-opening`, shut on `door-closed`.
- **Hmr** respawns it and rejects what was pending ("perception restarted"). The next query sets it up again. In DEV, one that fails to load is retried after 2s.

## Sight

- **Occluders.** These are the walls, the doors, and obstacles `standBlockHeight` tall, in world coords. Windows are not among them. They are the same occluders `gen-spots` makes its lists from (`docs/spots.md`).
- **Ids.** A door's or obstacle's id is `gmId * sightIdStride + localId`.
- **A line of sight** passes through the worker's `SegGrid`. Walls and tall obstacles stop it, and so do doors unless open.
- **To or from an npc,** sight is a body: lines to its centre and either side.
- **Spot to spot,** sight is the precomputed lists, with doors as they stand: `sight`, `always` and `via`. From a doable sat or lain at (`doArc`), it is `doSight` and `doVia` instead: from its point, within its arc. So it can be one-way, e.g. someone behind a chair sees its sitter, not the reverse.
