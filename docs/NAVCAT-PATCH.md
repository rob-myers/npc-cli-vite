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

`findCorners` drops a leading corner within `MIN_TARGET_DIST`, asked afresh every tick: cross in
and it goes, drift out and it returns. At a hairpin, dropping it turns them round, which takes them
out, which hands it back — they rock a centimetre short of a corner never reached.

Per agent, the corner steered at (`cornerTracked`) and the nearest they have been to it
(`cornerNearestSqr`) are kept. Within reach — half the agent's radius: pressed against someone (§4)
they skim a corner rather than cross it — the corner goes, and as the nearest only falls, never
comes back. A corridor that moves on resets both. The destination and off-mesh corners are kept.

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
