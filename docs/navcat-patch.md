# The navcat patch

`navcat` (the recast/detour port the crowd runs on) is patched via pnpm —
`patches/navcat@0.4.1.patch`, under `patchedDependencies` in `pnpm-workspace.yaml`. Four changes
in `dist/blocks.js`, with types in `dist/blocks/agents/crowd.d.ts`.

## 1. Four corners, not three

`updateCorners` asks `findCorners` for `4`. An npc's intention (`npc.getCorners`) is
`[position, ...agent.corners]`, and three could stop short of the door about to be passed.

## 2. `boundaryQueryRange`: walls looked for less far than npcs

Navcat gathers neighbours and wall segments within one `collisionQueryRange`. Walls found far out
slow a walker for a goal beside one; a long range for npcs is what lets them plan round each other.
The optional agent param is used by `updateLocalBoundaries` in place of `collisionQueryRange`, for
the gather and its re-gather threshold. `getAgentParams` sets both; `devHotReload` re-applies them.

## 3. A corner given up stays given up

Each tick an agent steers at the first corner of its corridor. Navcat gives a corner up only
whilst the agent is within `MIN_TARGET_DIST` (1 cm) of it, tested afresh every tick. The patch
remembers, per agent, the corner steered at (`cornerTracked`) and the nearest they have been to
it (`cornerNearestSqr`); once that nearest is within *reach* the corner goes, and since a nearest
only falls, it never comes back. A corridor that moves on resets both. The destination and
off-mesh corners are never given up.

Three cases, all seen as an npc rocking back and forth, the corner popping in and out in
`demo_corners`:

- **A hairpin.** The corner beyond lies behind them. Giving the first corner up turns them
  round, which carries them back out of the 1 cm, which hands it back. *Rule: given up for good.*
- **A skimmed corner.** Pressed against an idle npc (§4) they slide along its body, passing a
  corner a few centimetres off rather than over it — never within 1 cm, so steering swings
  round for it once they are past. *Rule: reach is half the agent's radius.*
- **A corner beside an idle npc.** Corners are navmesh vertices, and an npc left standing —
  parked along the boundary, or padded out in a room — may be within two radii of one. Their
  body then keeps a walker from coming even half a radius from it; they pass, swing back, and
  re-pass it for ever. *Rule: beside a near-still neighbour, reach grows by the nearest their body allows —
  `agent.radius + nei.radius - distance(neighbour, corner)`.*

The neighbours are only looked at with the corner under three radii off, and by squared
distances, so on most ticks the rule costs one comparison.

## 4. Pressed against an npc, the desired velocity folds onto their tangent

Avoidance scores a candidate partly by its distance from the desired velocity `dvel`. Touching an
npc with `dvel` pointing through them, every open candidate is a slide along their tangent, and a
slide differs from `dvel` more than standing still does, at any speed: they crawl, `updateStuck`
calls it still, the move is rejected. No parameter fixes it — the term is minimised at rest.

`sampleVelocityAdaptive` folds `dvel` onto the tangent of the first touched circle it points into,
at its speed; only the sampler's copy changes. The side is the lean of `dvel`, else the side bias's
(`-np`), and is kept whilst in contact (`query.foldSide`): a slide crosses lines a string-pulled
corner comes and goes over, and re-choosing each tick would turn them back at every flip. Contact
only (`0.02`): folding from wider, a corner just past their far side is folded away from for ever.

## Editing the patch

```sh
pnpm patch navcat@0.4.1          # extracts WITH the current patch applied, prints the dir
# edit dist/blocks.js and the .d.ts beside it, under the printed dir
pnpm patch-commit "$PWD/node_modules/.pnpm_patches/navcat@0.4.1"   # rewrites the patch, reinstalls
```

`patch-commit` changes the hash in `pnpm-lock.yaml` and navcat's path under `node_modules/.pnpm`:
restart the TypeScript server and the dev server. Delete the edit dir and any superseded
`node_modules/.pnpm/navcat@0.4.1_patch_hash=…` copy afterwards — a stale one is easily read by
mistake. `pnpm patch` refusing means an edit dir was never committed. Only `dist/` is patched;
`src/` is shipped for reference, not run.
