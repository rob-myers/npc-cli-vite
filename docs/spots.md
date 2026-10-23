# Spots

A spot is a place an npc might stand, made per geomorph key with what it sees and what is near. Behaviours query them. The Decorator's **spots** layer shows them.

## Where

| What | Where |
| --- | --- |
| Output | `packages/app/public/spot/{gmKey}.json`, committed. One spot a line. None for a playground geomorph (`--playground`), which is edited at runtime: it has no spots. |
| Schema | `packages/ui/world/src/spot.schema.ts` |
| Making them | `computeSpots` in `packages/ui/world/src/service/spots.ts`, tuned by `spotConfig` there |
| Bin | `scripts/src/bins/gen-spots.ts` (`--force`, `--gmKeys='["g-101--multipurpose"]'`) |
| Dev server | `scripts/src/vite-plugin-spots.ts`. `POST /api/gen-spots` forces a run. |
| View | `packages/ui/decorator/src/SpotsLayer.tsx`. The sidebar's spot tab (`SpotCard.tsx`) shows one, pressed on the map or entered by key, e.g. `g0s455`. |
| Queries | The perception worker holds the map's spots (`cli/src/jsh/world/worker/spots.ts`): see `docs/perception.md`. Main sends a batch with `spotQuery(ct, queries)` (`perception.main.ts`), one round trip each. Sight from or to an npc is a line from their own point through that worker's occluders, across geomorphs, through open doors. Spot to spot it is the precomputed `sees`, plus `seesVia` an open door. An npc's spots (`spots of:rob`) are those of their room within 1 m, else its nearest, and in a doorway the other side's too. jsh: `spot of:rob` (the nearest), `spots of:rob` (all), `spot g0s12`, `sees g0s12 g0s40`, `spots room:… kind:… near:…`. Between npcs `sees` also asks their eyes and facing: see `docs/scenarios.md` |

## Coords

Spots are in their geomorph's own coords, like `layout.rooms`. Apply the instance `transform` for world coords. `x/y` is the world's `x/z`.

## Kinds

Spots are made in this order, and a later one too near (`mergeGap`) an earlier one is dropped. Doables are always kept. A wall or cover spot too near only doable, doorway or door spots slides along its wall instead, so a wall beside a door keeps one.

- **doable**: a seat or bed (`meta.do`). `facing` is its `orient`.
- **doorway**: either side of a door, in its doorway, facing it.
- **door**: at a door's centre, bar a hull door. Whoever stands there holds it open, so its lists ignore that door. It is in no room, and `hide` and `makeWay` never choose it.
- **corner**: where the walkable boundary turns outwards, as round a wall's end or an obstacle.
- **cover**: along an obstacle that hides someone fully crouched (`crouchHideHeight` up to `standBlockHeight`).
  - A spot crouching hides from no one behind the obstacle is a wall spot instead, e.g. at a desk against a wall.
- **wall**: along a wall or a tall obstacle, facing into the room.
- **decor**: by a decor quad, other than a switch.
- **fill**: the gaps between, at least `fillGap` from any other.

## Fields

- `depth`: metres to the nearest occluder at each of `angles` directions from `+x`, capped at `radius`.
- `seesDoors`: doors in sight at a quarter, half or three quarters across.
- `near`: doors, decor, doables and obstacles within `nearRadius`. Decor and doables index `layout.decor`. Obstacles index `layout.obstacles`, whose `meta` says what they are.
- **Region sight**, within `radius`, between regions: the floor within `regionRadius` of each spot.
  - `sight`: spots it may see with no door.
  - `always`: spots every line to which is clear.
  - `via`: `[doorIds, spotIds]`, those it may see once all those doors are open. One seen by several routes, e.g. through either of two doors, is listed under each: any one open will do.
  - A route's doors come from clear lines between the regions. One seen only past a body's edge is found by a line to that edge.
  - `crouchSafe` (cover only): spots that cannot see it fully crouched.
  - A spot in none of them is never seen from its region.
- **Seated sight** (doables only): `doArc`, and `doSight` / `doVia` as seen from its point within that arc.
- **Per file:** `rooms` (rooms which may see each other) and `hull` (by hull door, the spots which may see its opening).

Sight is as stood. Walls, shut doors and obstacles of `standBlockHeight` or more block it. Windows do not, as for the player light. How sight is asked of them, including across hull doors: `docs/perception.md`.

An obstacle reaches down from its top (`height`) by `meta.h`, else by `sightConfig.obstacleDepth` (0.5 m, as `Obstacles` draws it). One whose bottom is at `standBlockHeight` or above hangs over anyone stood, e.g. a window's lintel, so it blocks nothing.

## How they are made

1. A navcat navmesh is built per geomorph in Node (`createGmNavMesh`), from `layout.navDecomp`, as the nav worker builds the map's.
2. Its boundary edges are walked. Each is put down to the wall or obstacle nearest its middle, which gives wall and cover spots.
3. Fill spots are on a grid, kept only on the navmesh.
4. Sight is segment tests through a grid of occluders (`SegGrid`).

## When they are made

- `gen-assets-json` rewrites `assets.json`. The plugin sees that and runs `gen-spots` in a child process, then sends `spotsChangedEvent`, and the Decorator refetches.
- A geomorph is skipped while its `layoutHash` is unchanged. That hash covers its layout and the code in `spots.ts`, so editing it remakes every geomorph.
