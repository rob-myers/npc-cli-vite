# Perception

Perception answers spot and sight queries: where npcs might stand, and who sees whom. It runs on the nav worker, beside jsh's plan ops. Editing its code respawns the worker but keeps the navmesh (`docs/workers.md`).

| Side | File | What |
| --- | --- | --- |
| main | `packages/cli/src/jsh/world/perception.main.ts` | `spotQuery`, `spotQueryDetached` |
| main | `packages/cli/src/jsh/world/worker.main.ts` | every jsh request, the map setup and door changes |
| worker | `packages/cli/src/jsh/world/worker/handle-perception.ts` | setup, doors, queries |
| worker | `packages/cli/src/jsh/world/worker/spots.ts` | the map's spots, and `answerSpotQueries` |
| shared | `packages/ui/world/src/service/spot-sight.ts` | what blocks sight (`sightOccluders`), and how the static lists are made |

The plan ops (`park`, `pad`, `nudge`, `boundary`) share the worker and its setup: `plan.main.ts` on main, `worker/plan.worker.ts` there. See `docs/workers.md`.

## Queries

`spotQuery(ct, queries)` sends a batch in one round trip, under the shell's pause and kill (`awaitPausable`). `spotQueryDetached(w, queries)` does the same from no process, e.g. sidestep's keyed tick.

- **The npcs a batch names** are snapshotted as it is sent: their point, and their rooms (both sides in a doorway).
- **The queries** (`WW.SpotQuery` in `jsh-worker.d.ts`): `of`, `get`, `list`, `sees`, `seenBy`, `at`, `hide`, `hidden`, `makeWay`, `view` and `explain`.
- **Callers**: `act.ts`, `spot.ts` (jsh `spots`, `spot`, `sees`) and `sidestep.ts`.

## Setup and doors

- **The worker** is the World's nav worker. Its life, HMR and retry are `NavWorker`'s.
- **Set up** (`jsh-setup`, shared with the plan ops) per worker, map, layout and spots rev:
  - the geomorphs, whose spot files it fetches (`public/spot/{gmKey}.json`, none for a playground);
  - what blocks sight (`sightOccluders`);
  - the doors seen through.
- **Doors** are told as they change (`perception-door`): open on `door-opening`, shut on `door-closed`. One feed per World, from its first request, posts to whichever worker is current.
- **A respawn** rejects what was pending ("worker terminated"). The next request sets it up again.

## Sight

- **Occluders.** These are the walls, the doors, and obstacles `standBlockHeight` tall, in world coords. Windows are not among them. They are the same occluders `gen-spots` makes its lists from (`docs/spots.md`).
- **Ids.** A door's or obstacle's id is `gmId * sightIdStride + localId`.
- **A line of sight** passes through the worker's `SegGrid`. Walls and tall obstacles stop it, and so do doors unless open.
- **To or from an npc,** sight is a head: lines to its eyes and either side, inside the head.
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
4. **Lines,** for the rest: from `a`'s eyes to `b`'s, to their centre and either side. An npc's eyes are on the front of their head as last posed, from its bone (`eyeOf` in `perception.main.ts`), so they follow a crouch, a seat, a bed or a top bunk. A spot's are 1.37 m up. A low obstacle stops a line passing at or below its top. Lines to a fully crouched npc end 0.6 m up by rule, though their head clears a desk, so cover `crouchHideHeight` tall hides them.

**The cache** (`seesCache` in `worker/spots.ts`) holds steps 2 to 4's verdict, seen or not, for a pair with an npc in it.
- **Its key:** each npc's name, position to the centimetre, posture and crouch (a spot's is its key), then the doors' revision. Any door opening or shutting, or a new setup, bumps that revision, so every earlier answer goes unused.
- **What it serves:** only those standing still. Anyone walking moves more than a centimetre a tick, so is always worked out afresh. Coarser steps (a quarter metre, then 5 cm) gave wrong answers near a wall's edge, where sight changes within a step.
- **Who uses it:** `sees` between npcs (`seesNow`) reads it first, and stores what it works out. `hide`, `hidden`, `view` and `sees --debug`'s `explain` never touch it.
- **Its size:** 2000 answers. When full, the oldest goes.
- Step 1, eyes and facing, is on main and never cached.

## `hide` and `hidden`

- **Unsafe** is every spot the watchers' spots may see by the lists, as the doors stand. So are those seen from where they are walking to.
- **`hide`** picks the best spot not unsafe, with no lines. With `strict`, as jsh `act hide` asks, every spot it would count as at must be unsafe-free with its room's doors open, as the hider opens one going in or stands by one.
- **`hidden`** asks whether none of the hider's spots are unsafe, their rooms' doors open: `act hide`'s judgement on arrival. It names those seen.
- jsh `act avoid` picks with `hide` alone, and judges on arrival by lines from the watchers' eyes (`explain`, as `sees --los`).

## Across hull doors

- **A hull door is two records,** one in each geomorph it joins, e.g. `g0d3` and `g1d7`. Main sends these `hullPairs` in setup.
- **A pair of spots** in different geomorphs may see each other only if each is on its side's `hull` list for the two records of one door, with that door seen through.
- **Not covered:** sight through two hull doors.

## Seeing it in the World

**The spots overlay** is **spots** in the debug **overlay** select, or the `0` key (`w.debug.toggleSpots`, persisted).
- Every spot of the map is a billboard icon by kind (`media/src/decor/icon--spot-*.svg`, Phosphor duotone, white so a colour tints them). One with a facing has a faint open arrow on the floor, that way, bar cover, seats and beds.
- They are coloured by sight from the player: blue their own, green `always`, yellow `may`, white once a shut door opens, grey `never`. Only in the "sight" fade mode do they fade with their room. A door spot shows whilst either of its rooms does. They fade with the world's fold too (`w.view.foldNode`), so come up as it unfolds on load.
- jsh `spot_overlay`, run by the profile, fills it: `list` once per map, then the worker's `view` query as the focus moves or doors change. The World only draws (`w.debug.setSpots`, `colourSpots`).
- A right click on one, or a long press on touch, chooses it in an open Decorator alone (event `spot-chosen`), which says "decorator selected" on the player's bar. The overlay still colours from the player, and the Decorator's own choice never reaches it. A press walks there, as on the floor.

**`sees --debug a b`** runs until killed, from the worker's `explain` query. It prints each pair and why, e.g. `rob → kate fov`, again whenever that changes, seen pairs first: the arrow green if seen, red if not. It draws the rays a verdict needed, at the heights it tested: green clear, red stopped, amber stopped by a low obstacle in a pair still seen (`partial`). It looks again every tick whilst it draws rays, as they follow the heads, else every quarter game second. An npc removed meanwhile is `gone`, and picked up again if they return. `--los` ignores eyes and facing, `--all` takes every ordered pair.
