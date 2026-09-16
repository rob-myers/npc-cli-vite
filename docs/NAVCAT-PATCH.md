# The navcat patch

`navcat` (the recast/detour port the crowd runs on) is patched via pnpm —
`patches/navcat@0.4.1.patch`, wired up under `patchedDependencies` in `pnpm-workspace.yaml`. Four
changes in `dist/blocks.js`, with types in `dist/blocks/agents/crowd.d.ts`.

## 1. Four corners, not three

`updateCorners` asks `findCorners` for `4` corners, not `3`. An npc's intention — `npc.getCorners`
in `components/npc.ts` — is `[position, ...agent.corners]`, and three could stop short of the door
they were about to pass through. (Commit `a1065b15`.)

## 2. `boundaryQueryRange`: walls looked for less far than npcs

Navcat gathers both neighbouring agents and the local boundary's wall segments within
`collisionQueryRange`. Avoidance penalises any velocity heading at a wall inside its time horizon,
so walls found further out slow a walker for a goal beside one — whilst a longer range for npcs is
what lets them plan round each other.

The patch adds an optional agent param `boundaryQueryRange`, copied on in `addAgent` and used by
`updateLocalBoundaries` in place of `collisionQueryRange`, for both the gather and its re-gather
threshold. Unset, behaviour is navcat's; neighbours and separation are untouched. `getAgentParams`
in `components/NPCs.tsx` sets both, and `devHotReload` re-applies them to live agents.

## 3. A corner given up stays given up

`findCorners` drops a leading corner within `MIN_TARGET_DIST`, and `updateCorners` asks afresh
every tick — a symmetric test: cross in and the corner goes, drift out and it returns. Where the
corner beyond lies behind them, a hairpin, dropping one turns them round, which takes them back
out, which hands it back: they rock a centimetre short of a corner they never reach. The loop's
size follows the threshold, so tuning it only resizes the wobble.

The patch keeps per agent the corner steered at (`cornerTracked`) and the nearest they have been
to it (`cornerNearestSqr`). A corner goes once that nearest is within reach, and a nearest only
falls, so it never comes back — steering stays on the corner beyond whilst they round it. A
corridor that moves on puts a different point first, and both reset to it. The destination and
off-mesh corners are never dropped.

## 4. Pressed against an npc, the desired velocity folds onto their tangent

Avoidance scores each candidate velocity partly by its distance from the desired one, `dvel`.
Touching an npc with `dvel` pointing through them, every open candidate is a slide along their
tangent — and a slide differs from `dvel` MORE than standing still does, whatever its speed. So
the walker crawls at ~0.02 m/s, `updateStuck` calls it still, and the move is rejected. No
parameter fixes it: the term is minimised at rest.

`sampleVelocityAdaptive` now folds `dvel` onto the tangent of the first touched circle (within
`0.02` of contact) it points into, keeping its speed — the side it leans to, else the side the
side-bias prefers (`-np`). Only the sampler's local copy changes; `agent.desiredVelocity` is
untouched. Costs a dot and a distance per neighbour.

## Editing the patch

```sh
pnpm patch navcat@0.4.1          # extracts WITH the current patch applied, prints the dir
# edit dist/blocks.js and the .d.ts beside it, under the printed dir
pnpm patch-commit "$PWD/node_modules/.pnpm_patches/navcat@0.4.1"   # rewrites the patch, reinstalls
```

`patch-commit` changes the patch hash in `pnpm-lock.yaml` and navcat's path under
`node_modules/.pnpm`: restart the TypeScript server, and the dev server too.

`pnpm patch` refusing means an edit dir was never committed — look at it before deleting. Only
`dist/` is patched; navcat's `src/` is shipped for reference, not run.
