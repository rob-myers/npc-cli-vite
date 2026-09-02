# Npc outlines — what was built, before removing

Reconstructed from git history. The feature was tried twice and removed twice; nothing of it is left
in the tree. Everything below is independent — take any piece on its own.

| commit | |
|---|---|
| `eee4ac0a` | feat: mrt npc outline (debug option) — first attempt |
| `263f3cd1` | feat: remove npc outlines — first removal |
| `01842fc5` | feat: optional npc outlines + custom color + composed alpha — second attempt |
| `bdc418cd` | feat: npc outlines should include alpha |
| `4c727787` | fix: npc outlineColour should not tint whole npc when behind doors |
| `f62fe4f1` | fix: framerate: remove mrt when npc outline off |
| `eae46a06` | fix: outlines fade with colorScale |
| `0ad34d55` | feat: remove npc outlines — second removal |

The final state is `0ad34d55^`; `git show 0ad34d55^:packages/ui/world/src/service/npc-outline.ts`
brings back the whole shader.

## The idea

A border just outside every npc's silhouette, so a person reads against a busy floor. Drawn in the
post pass, from a silhouette the scene pass writes — **not** by edge-detecting the colour buffer,
which cannot tell an npc from a similarly coloured wall behind them.

## The silhouette: an extra MRT attachment

`WorldView.setupPostProcessing` gave the scene pass a second output:

```ts
state.npcMaskMrt = mrt({ output, npcMask: vec4(0, 0, 0, output.a) })
  .setBlendMode("npcMask", createNpcMaskBlend());
scenePass.setMRT(state.npcMaskMrt);
```

Only npcs opt in, via `material.mrtNode` in `NPCs.createMaterials`. Four things had to be true at
once, and each was found the hard way:

1. **The attachment must BLEND.** No MRT output but `output` itself does by default — every other
   fragment *replaces* what is there, so the walls (`renderOrder` 4 against the npcs' 0, both
   transparent) wiped the mask of anyone behind them. Blended, the attachment does two jobs at once:
   an npc writes their coverage as the weight, and everything else writes `vec4(0)` weighted by its
   OWN opacity — so a see-through wall scales what is behind it by `1 - opacity` instead of clearing
   it, which is exactly what dims an npc's border to match how much of them shows through. Solid
   geometry draws before the npcs, so its full weight only ever clears an empty buffer.
2. **three's `MRTNode.merge` drops blend modes.** It puts them on `blendings`, which nothing reads —
   `getBlendMode` looks at `blendModes` — so the merge every material with an `mrtNode` of its own
   goes through left `npcMask` unblended. Patched at the source, by wrapping `merge`:
   ```ts
   const originalMerge = state.npcMaskMrt.merge.bind(state.npcMaskMrt);
   state.npcMaskMrt.merge = (other) => {
     const merged = originalMerge(other);
     merged.blendModes = { ...state.npcMaskMrt?.blendModes, ...other.blendModes };
     return merged;
   };
   ```
3. **The alpha channel of a secondary attachment is unusable.** three clears every MRT attachment
   past the first to alpha `1`, giving only the first the real clear value (see `WebGPUBackend`), so
   nothing accumulated there can be told from that. Hence the packing below, which keeps to `rgb`.
4. **The pick pass must declare the same MRT.** `pickObject` renders the scene into `pickRT`, and the
   npc material declares the extra output whilst outlining — so that pass needed
   `renderer.setMRT(state.npcMaskMrt)` and `pickRT` a matching attachment count, else the pipeline
   would not validate. `createPickRT(count)` also had to NAME its textures (`"output"`, `"npcMask"`):
   `MRTNode` maps entries onto attachments by texture name (`getTextureIndex`), which `PassNode` sets
   for us but a hand-made target does not — unnamed, the pick colour never reached attachment 0.

## Per-npc colour, packed into two channels

`r` is spoken for (it carries coverage), leaving `gb`. `packOutlineColor` put the hue in as 3:3:2
bits with its brightness riding alongside, rather than quantising the colour whole — a grey is then
exact whatever its value, where 3 bits of a dark grey would not be:

```ts
const brightest = Math.max(r, g, b, 1e-4);
const code = (round((r / brightest) * 7) << 5) | (round((g / brightest) * 7) << 2) | round((b / brightest) * 3);
out.set(code / 255, brightest);
```

Both are recovered as ratios against `r`, and whatever dimmed one dimmed all three alike — so the
colour that comes back is the colour that went in, however much stands in front of it. The npc wrote
it as a uniform (`outlinePack`), so `npc.setOutlineColor(color)` needed no material rebuild, only a
`forceUpdate` in case the world was paused. Exposed to the shell:

```sh
w n.rob.setOutlineColor red
w n.rob.setOutlineColor gray
```

**PREMULTIPLIED, against an alpha of `1`** — which under the blend is a replace, and the npc must
replace rather than accumulate: an arm passing over the torso writes the mask twice, and blending
sums it, so a half-faded npc came out lumpy along every limb that overlapped them. At full coverage
the sum saturates and nothing shows, which is why only a fade ever revealed it (`eae46a06`):

```ts
vec4(vec3(1, outlinePack.x, outlinePack.y).mul(colorScale).mul(fold), 1)
```

## Growing the border — `getNpcOutline`

Eight taps at `outlineWidthPx = 4`, diagonals shortened by `SQRT1_2` so the border keeps an even
width, unrolled whilst building the node graph so no loop reaches the shader. Then:

- **Depth-tested per tap.** three's log depth is `viewZ = -near * e^(depth * ln(far/near))`, so a
  larger raw depth is farther away. Where we are nearer than the npc we are occluding them, and the
  boundary is the occluder's edge rather than the npc's — no outline there. `depthBias = 0.00002`
  guards where the two surfaces nearly touch.
- **The strongest neighbour wins the colour**, kept packed until the end, so two npcs side by side
  each keep their own and only the winner is ever unpacked.
- **A RELATIVE rim**: `rim = strength - onNpcHere`, which is `0` everywhere on an npc and rises to
  their full coverage just outside them. An absolute threshold reads an npc dimmed past it as
  background and paints the border straight across them.
- **`onNpcHere` is dilated by a pixel** (`4c727787`). A door sees through by COVERAGE rather than by
  blending (see `Doors`' panel materials), so it writes depth on the samples it covers and the npc
  behind it is REJECTED on those rather than dimmed — and the coverage is dithered, so what survived
  was a pixel-wide checker of full coverage and none. Each hole read as background and took a border
  of its own, which is what painted an occluded npc solid. A wall never did this: it blends, which
  scales the whole mask evenly and leaves no hole. The border loses its innermost pixel in exchange.

Returned as a LAYER (`vec4`, alpha in `a`), not a finished colour — mixing it into the scene colour
would blend it towards the nothing the scene left in a gap in the floor. `post-processing.apply`
composited it over the premultiplied world before the backdrop, source-over:

```ts
const edge = getNpcOutline(npc.mask, npc.depth);
const behind = edge.a.oneMinus();
world.assign(edge.rgb.mul(edge.a).add(world.mul(behind)));
coverage.assign(edge.a.add(coverage.mul(behind)));
```

`outlineAlpha = 0.25`, so what the border sits on still reads through it.

## Turning it off cost nothing

`f62fe4f1`: the MRT is DECLARED only whilst outlines are wanted, so off is a frame with no extra
attachment rather than one writing something nobody reads. That means three things move together —
`npcMaskMrt`, `pickRT`'s attachment count (`syncPickRT`), and every npc's `material.mrtNode`
(`NPCs.syncOutlineMask`, which sets `needsUpdate`) — and `PostProcessing`'s effect depends on
`w.view.npcOutline` as well as `postFx.uid`, since the pipeline captured the node graph.

Settings: `npcOutline: boolean` in `WorldSettings` (default `true`), `setNpcOutlineEnabled` on
`WorldView` (turning the post pass on if it is off, as `postFade` does), and a **"Npc Outline"** row
in `WorldMenu`'s `debugItems`. Default colour `npcOutlineColor = "#555"` in `const.ts`.

## Why it went

No reason is recorded in either removal commit — both are a bare `feat: remove npc outlines`. What
the history does show is the cost: an extra attachment on the scene pass AND the pick pass, a patched
`MRTNode.merge`, a per-npc `mrtNode` that must track a global, a colour squeezed through 8 bits, and
four bug-fix commits for occlusion, alpha, framerate and fading. The look was a `0.25`-alpha border.

## If restoring

`git show 0ad34d55 --` is the removal diff — reverting it is most of the job. Two caveats:

- That commit also flipped `pickDoors`'s default (`true` → `false`) and reworded a jsdoc; those are
  unrelated hitchhikers, leave them.
- `WorldView` and `NPCs` have since changed around the touched lines — notably `createMaterials` now
  takes a mutable `pickIdUniform` rather than a `pickId`, and `post-processing.apply`'s second
  parameter is now `prod` (see `service/fade-rooms`). Expect to re-apply by hand rather than
  `git revert`.
