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
- **The queries** (`WW.SpotQuery` in `jsh-worker.d.ts`): `of`, `get`, `list`, `sees`, `seenBy`, `at`, `hide`, `hidden`, `makeWay`, `view` and `explain`.
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

## Npcs in the lists

- **Their spots.** A standing npc is at their region spots: those of their room(s) within `regionRadius`, else the nearest.
- **Sitting or lying,** an npc is at the doable they use (`w.npc.npcToDoable`, sent as `doAt`), if it has an arc.
- **Rooms in view** (`seeRooms`) come from `w.e.roomsInView`, which walks the room graph through doors seen through. It is cached by room until a door changes.

## `sees` with an npc

Each step only runs if the one before leaves it open:
1. **Eyes and head facing,** on main (`perceive` in `spot.ts`).
2. **Rooms:** `b` must be in a room `a` has in view.
3. **The lists,** over every pair of their spots: never listed is no, `always` is yes unless `b` is crouched.
4. **Lines,** for the rest: from `a`'s eye to the top of `b`'s body, at fixed heights by posture (`bodyHeights`) above what they are on: the floor, else their seat or bed (its `meta.y`, so a top bunk too). Lying, on their back or a side. A low obstacle stops one passing at or below its top. A fully crouched npc's top is 0.6 m by rule, though their head is above a desk, so cover `crouchHideHeight` tall hides them.

**The cache** (`seesCache` in `worker/spots.ts`) holds steps 2 to 4's verdict, seen or not, for a pair with an npc in it.
- **Its key:** each npc's name, position to the centimetre, posture and crouch (a spot's is its key), then the doors' revision. Any door opening or shutting, or a new setup, bumps that revision, so every earlier answer goes unused.
- **What it serves:** only those standing still. Anyone walking moves more than a centimetre a tick, so is always worked out afresh. Coarser steps (a quarter metre, then 5 cm) gave wrong answers near a wall's edge, where sight changes within a step.
- **Who uses it:** `sees` between npcs (`seesNow`) reads it first, and stores what it works out. `hide`, `hidden`, `view` and `sees --debug`'s `explain` never touch it.
- **Its size:** 2000 answers. When full, the oldest goes.
- Step 1, eyes and facing, is on main and never cached.

## `hide` and `hidden`

- **Unsafe** is every spot the watchers' spots may see by the lists, as the doors stand. So are those seen from where they are walking to.
- **`hide`** picks the best spot not unsafe, with no lines.
- **`hidden`** asks whether none of the hider's spots are unsafe.

## Across hull doors

- **A hull door is two records,** one in each geomorph it joins, e.g. `g0d3` and `g1d7`. Main sends these `hullPairs` in setup.
- **A pair of spots** in different geomorphs may see each other only if each is on its side's `hull` list for the two records of one door, with that door seen through.
- **Not covered:** sight through two hull doors.

## Seeing it in the World

**The spots overlay** is **spots** in the debug **overlay** select, or the `0` key (`w.debug.toggleSpots`, persisted).
- Every spot of the map is a billboard icon by kind (`media/src/decor/icon--spot-*.svg`, Phosphor duotone, white so a colour tints them). One with a facing has a faint open arrow on the floor, that way, bar cover, seats and beds.
- They are coloured by sight from the chosen spot, else the player: blue their own, as is the chosen one (larger), green `always`, yellow `may`, white once a shut door opens, grey `never`. Only in the "sight" fade mode do they fade with their room. A door spot shows whilst either of its rooms does.
- jsh `spot_overlay`, run by the profile, fills it: `list` once per map, then the worker's `view` query as the focus moves or doors change. The World only draws (`w.debug.setSpots`, `colourSpots`).
- A right click on one chooses it, or a long press on touch (`w.debug.chooseSpot`, event `spot-chosen`). Again, it is let go. The Decorator follows, and its own choice is followed back. A press walks there, as on the floor.

**`sees --debug a b`** runs until killed, from the worker's `explain` query. It prints each pair and why, e.g. `rob → kate fov`, again whenever that changes, seen pairs first: the arrow green if seen, red if not. It draws the rays a verdict needed, at the heights it tested: green clear, red stopped, amber stopped by a low obstacle in a pair still seen (`partial`). It looks again every quarter game second, and every tick whilst rays are drawn for someone moving. `--los` ignores eyes and facing, `--all` takes every ordered pair.
