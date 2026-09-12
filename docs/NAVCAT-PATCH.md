# The navcat patch

`navcat` (the recast/detour port the crowd runs on) is installed with a pnpm patch,
`patches/navcat@0.4.1.patch`, wired up under `patchedDependencies` in `pnpm-workspace.yaml`. It
changes two things in `dist/blocks.js`, with matching types in `dist/blocks/agents/crowd.d.ts`.

## 1. Four corners, not three

`updateCorners` asks `findCorners` for `4` corners per agent rather than navcat's `3`.

An npc's intention — the path drawn ahead of them, `npc.getCorners` in `components/npc.ts` — is
`[position, ...agent.corners]`. With three corners it could end short of the door the agent was
about to pass through, so the drawn path stopped at the doorway rather than piercing it. One more
corner reaches through. (Commit `a1065b15`.)

## 2. `boundaryQueryRange`: walls looked for less far than npcs

Navcat uses one range, `collisionQueryRange`, both to find neighbouring agents and to gather the
wall segments of the agent's local boundary — which is what obstacle avoidance steers against.
Avoidance penalises every velocity heading at a wall inside its time horizon, so the further out
the walls are found, the earlier a walker slows for a goal beside one — whilst for npcs a longer
range is what lets a walker plan round them.

The patch adds an optional agent param `boundaryQueryRange`, copied onto the agent in `addAgent`
and used by `updateLocalBoundaries` in place of `collisionQueryRange` — for both the gather and
the "moved far enough to re-gather" threshold. Unset, behaviour is exactly navcat's. Neighbour
search and separation are untouched and still use `collisionQueryRange`.

`getAgentParams` in `components/NPCs.tsx` sets `collisionQueryRange: 0.6` and
`boundaryQueryRange: 0.4`, and `devHotReload` re-applies both to live agents.

## Editing the patch

```sh
pnpm patch navcat@0.4.1          # extracts the package WITH the current patch applied, prints the dir
# edit files under node_modules/.pnpm_patches/navcat@0.4.1 — dist/blocks.js and the .d.ts beside it
pnpm patch-commit "$PWD/node_modules/.pnpm_patches/navcat@0.4.1"   # rewrites the patch, reinstalls
```

`patch-commit` changes the patch hash in `pnpm-lock.yaml` and the package's path under
`node_modules/.pnpm`, so an open TypeScript server may keep the old types until restarted.

If `pnpm patch` refuses because the edit dir is not empty, a previous edit was never committed:
look at what is in it before deleting it. Only the built `dist/` is patched — navcat's `src/` is
shipped for reference but not what runs.
