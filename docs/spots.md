# Spots

A spot is a place an npc might stand, made per geomorph key with what it sees and what is near. Behaviours query them. The Decorator's **spots** layer shows them.

## Where

| What | Where |
| --- | --- |
| Output | `packages/app/public/spot/{gmKey}.json`, committed. One spot a line. |
| Schema | `packages/ui/world/src/spot.schema.ts` |
| Making them | `computeSpots` in `packages/ui/world/src/service/spots.ts`, tuned by `spotConfig` there |
| Bin | `scripts/src/bins/gen-spots.ts` (`--force`, `--gmKeys='["g-101--multipurpose"]'`) |
| Dev server | `scripts/src/vite-plugin-spots.ts`. `POST /api/gen-spots` forces a run. |
| View | `packages/ui/decorator/src/SpotsLayer.tsx` |
| Queries | The jsh worker holds the map's spots (`cli/src/jsh/world/worker/spots.ts`). Main sends a batch with `spotQuery(ct, queries)` (`plan.main.ts`), one `spots` op per round trip. jsh: `spot of:rob`, `spot g0s12`, `sees a b`, `spots room:… kind:… near:…` |

## Coords

Spots are in their geomorph's own coords, like `layout.rooms`. Apply the instance `transform` for world coords. `x/y` is the world's `x/z`.

## Kinds

Spots are made in this order, and a later one too near (`mergeGap`) an earlier one is dropped. Doables are always kept.

- **doable**: a seat or bed (`meta.do`). `facing` is its `orient`.
- **door**: either side of a door, facing it.
- **corner**: where the walkable boundary turns outwards, as round a wall's end or an obstacle.
- **cover**: along an obstacle that hides someone fully crouched (`crouchHideHeight` up to `standBlockHeight`).
- **wall**: along a wall or a tall obstacle, facing into the room.
- **decor**: by a decor quad, other than a switch.
- **fill**: the gaps between, at least `fillGap` from any other.

## Fields

- `depth`: metres to the nearest occluder at each of `angles` directions from `+x`, capped at `radius`.
- `sees`: spots in a clear line, within `radius`. `seesVia` are those through exactly one door, as `[spotId, doorId]`.
- `seesDoors`: doors in sight at a quarter, half or three quarters across.
- `near`: doors, decor, doables and obstacles within `nearRadius`. Decor and doables index `layout.decor`. Obstacles index `layout.obstacles`, whose `meta` says what they are.
- `crouchHidden` (cover only): spots in `sees` whose line to it crosses a low obstacle beside it. Fully crouched, it is hidden from them.

Sight is as stood, with doors shut. Walls, shut doors and obstacles of `standBlockHeight` or more block it. Windows do not, as for the player light. "Hidden from" is not stored: it is what `sees` leaves out.

## How they are made

1. A navcat navmesh is built per geomorph in Node (`createGmNavMesh`), from `layout.navDecomp`, as the nav worker builds the map's.
2. Its boundary edges are walked. Each is put down to the wall or obstacle nearest its middle, which gives wall and cover spots.
3. Fill spots are on a grid, kept only on the navmesh.
4. Sight is segment tests through a grid of occluders (`SegGrid`).

## When they are made

- `gen-assets-json` rewrites `assets.json`. The plugin sees that and runs `gen-spots` in a child process, then sends `spotsChangedEvent`, and the Decorator refetches.
- A geomorph is skipped while its `layoutHash` is unchanged. That hash covers its layout and the code in `spots.ts`, so editing it remakes every geomorph.
