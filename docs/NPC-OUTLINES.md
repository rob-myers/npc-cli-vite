# Npc outlines

A border just outside every npc's silhouette, so a person reads against a busy floor. Drawn in the
post pass from a silhouette the scene pass writes — **not** by edge-detecting the colour buffer,
which cannot tell an npc from a similarly coloured wall behind them.

On by default: `npcOutline` in `WorldSettings`, toggled by the **"Npc Outline"** row in
`WorldMenu`'s `debugItems`. It is drawn by the post pass, so asking for it turns "Post FX" on if
that is off.

| file | what it holds |
|---|---|
| `service/npc-outline.ts` | `createNpcMaskMrt`, `applyNpcOutline`, `syncNpcOutlineWidth`, the dials, `npcOutlineUid` |
| `components/WorldView.tsx` | `npcMaskMrt`, `syncPickRT`, `setNpcOutlineEnabled`, the composite |
| `components/NPCs.tsx` | each npc's `maskMrt` and `syncOutlineMask` |
| `components/npc.ts` | `Npc.maskMrt` |
| `service/storage.ts` | the `npcOutline` setting |

## 1. The silhouette — an `npcMask` MRT attachment

`WorldView.setupPostProcessing` gives the scene pass a second output, but only whilst the toggle is
on — off, no material writes it and the npc shader is exactly what it was:

```ts
state.npcMaskMrt = state.npcOutline === true ? createNpcMaskMrt() : null;
state.npcMaskMrt !== null && scenePass.setMRT(state.npcMaskMrt);
```

Npcs opt in with an `mrtNode` of their own (`NPCs.createMaterials`), writing coverage into `r`:

```ts
const maskAmount = colorScale.mul(fold).mul(bodyTint);
mrt({ npcMask: select(isMain, vec4(maskAmount, 0, 0, 1), vec4(0, 0, 0, 0)) })
```

The body only — the label is a billboard, and a border around it would read as a box floating
overhead. Scaled by everything that takes an npc away, so the border leaves with them: `colorScale`,
the `fold` of a map change, and `bodyTint`, which drains as they black out in `prod` and `dev` alike
— and reaches `0` before `prod`'s sphere wipe begins, so nothing outlines a figure already gone.

Four things have to be true at once, each found the hard way:

1. **The attachment must BLEND.** No MRT output but `output` itself does by default — every other
   fragment *replaces* what is there, so the walls wiped the mask of anyone behind them. Blended, it
   does two jobs at once: an npc writes their coverage as the weight, and everything else writes
   `vec4(0)` weighted by its OWN opacity, so a see-through wall scales what is behind it by
   `1 - opacity` rather than clearing it — which is what shows a border through a wall, dimmed by
   however much of the npc the wall lets through.
2. **three's `MRTNode.merge` drops blend modes.** It puts them on `blendings`, which nothing reads —
   `getBlendMode` looks at `blendModes` — so the merge every material with an `mrtNode` of its own
   goes through would leave `npcMask` unblended. Patched at the source by wrapping `merge` (still
   true of three 0.184).
3. **The alpha channel of a secondary attachment is unusable.** three clears every MRT attachment
   past the first to alpha `1`, giving only the first the real clear value (see `WebGPUBackend`), so
   nothing accumulated there could be told from that. Everything lives in `rgb`.
4. **The pick pass must declare the same MRT.** `pickObject` renders the scene into `pickRT` and the
   npc material declares the extra output, so that pass sets `renderer.setMRT(state.npcMaskMrt)` and
   `pickRT` carries a matching attachment count (`syncPickRT`). `createPickRT(count)` also NAMES its
   textures (`"output"`, `"npcMask"`): `MRTNode` maps entries onto attachments by texture name
   (`getTextureIndex`), which `PassNode` sets for us but a hand-made target does not — unnamed, the
   pick colour never reaches attachment 0.

## 2. What draw order does to the mask

three renders the **opaque list first, then the transparent list**; `renderOrder` only sorts within
a list (`painterSortStable` / `reversePainterSortStable`). So `transparent: false` puts an object
ahead of everything transparent whatever its `renderOrder` — which is why the doors, at
`renderOrder` 4, actually draw before the npcs at 0.

That gives a simple rule, and the two artifact classes fall straight out of it:

- **Drawn BEFORE the npcs, only depth matters.** The mask is still empty there, so writing `0` into
  it changes nothing. What such an object *can* do is depth-write, which rejects the npc's fragments
  behind it — the npc never writes those pixels and the mask comes out **holed**.
- **Drawn AFTER the npcs, only alpha matters.** The npc's mark is already down; a later fragment
  that passes the depth test scales it by `1 - opacity`. The mask is **dimmed**, never holed.

| object | list | `renderOrder` | `depthWrite` | what it does to the mask |
|---|---|---|---|---|
| `Doors` panels | opaque | 4 (ignored) | ✓ | draws first; dithered coverage → a stipple of holes |
| `Floor` | transparent | −3 | ✗ | nothing: before the npcs, and writes no depth |
| `Obstacles` | transparent | −3 | ✓ (alphaTest) | holes where it stands in front |
| `Decor` | transparent | −2 | ✓ (alphaTest) | holes the shape of its icons |
| `NPCs` | transparent | 0 | ✓ | writes the mask |
| `Walls`, trim | transparent | 4 | ✗ | dims it to `1 - 0.5` — the border shows through |
| `Ceiling` | transparent | 6 | ✓ | dims it where drawn |

**Holes are the enemy**, because a hole's rim is a silhouette as far as the border is concerned. The
depth test in §3 is what suppresses them; the dilation covers the door stipple, which is too fine
for it.

## 3. Growing the border

`applyNpcOutline` takes eight taps at `outlineWidth`, diagonals shortened by `SQRT1_2` so the border
keeps an even width, unrolled whilst building the node graph so no loop reaches the shader.

- **Depth-tested per tap.** A larger raw depth is farther away, so where what is drawn HERE is
  nearer than the npc found over there, we are standing in front of them and the boundary is our
  occluder's rather than theirs — no border. This is what stops decor and obstacles outlining
  themselves over an npc behind them. It costs the borders behind walls nothing: walls write no
  depth at all. `depthBias` guards where two surfaces nearly touch.
- **`here` is dilated by a pixel.** A door sees through by COVERAGE rather than by blending, so
  it writes depth on the samples it covers and the npc behind it is rejected on those — and the
  coverage is dithered, so what survives is a pixel-wide checker of full coverage and none. Each of
  those holes read as background and took a border of its own, which is what painted an occluded npc
  solid. The border loses its innermost pixel in exchange.
- **The rim is RELATIVE**, `step(here / max(strength, maskFloor), relativeCut)` — is there next
  to none of the mask here against the most there is nearby. Two wrong answers were tried first:
  - the *difference* of the values, `strength - here`, reads every step in the mask as a
    silhouette. A half-opaque wall crossing an npc then draws a border along its own edge — the
    white lines down the lintels, barely visible at `#555` and glaring at `#fff`.
  - a *fixed* threshold reads any floor under the mask as npc everywhere, and draws nothing at all.
- **How much shows through is a separate question**, answered by `strength`: the border's alpha is
  `rim * strength * outlineAlpha`, so it dims exactly as the npc does, whatever scaled them having
  scaled their mark alike. It also puts the border out where there is no npc within reach, `rim`
  being `1` by default out there.

## 4. Compositing, and the `Fn` it must be

The border goes over the FINISHED frame, between the backdrop composite and whatever demo effect is
hung off the end:

```ts
const composed = state.postFx.apply(scenePass.getTextureNode("output"), state.fadeRoomsFx.prodNode);
const bordered = state.npcMaskMrt === null
  ? composed
  : applyNpcOutline(composed, scenePass.getTextureNode("npcMask"), scenePass.getTextureNode("depth"));
pipeline.outputNode = state.demoFx.apply(bordered, state.demoPostFx);
```

**`applyNpcOutline` IS a TSL `Fn`.** The rim is built in `var`s, and outside a function there is no
scope for the assignments to land in — they are dropped silently and the border simply never
appears. This went unnoticed for as long as the composite lived inside `postFx.apply`'s own `Fn`,
and cost an hour when it moved out.

## 5. Turning it off, and hmr

Three things move together: `npcMaskMrt`, `pickRT`'s attachment count (`syncPickRT`), and every
npc's `material.mrtNode` (`NPCs.syncOutlineMask`). That last one assigns and sets `needsUpdate`
**unconditionally** — it is also how a material compiled against the last pipeline's pass is
recompiled against this one's, and the node it holds is the same object either way, so a
`!==` check would skip a recompile that is needed.

`PostProcessing`'s effect depends on `w.view.npcOutline` and on **`npcOutlineUid`**, a module
constant of `service/npc-outline`: an hmr of that file re-runs `WorldView` too, so the uid changes
and the pipeline is rebuilt. `useStateRef` merges in a `useMemo` during render, so
`setupPostProcessing` is already the new one by the time the effect looks — no `reset` flag needed
and no ordering hazard. Editing the dials below is therefore a live edit.

## Dials

| | |
|---|---|
| `outlineColor` | `color("#555")`, one colour for everyone |
| `outlineAlpha` | how opaque the border is |
| `outlineWidthPx`, `outlineWidthFarPx` | half-width at the near and far zoom stops. A border is a count of PIXELS, so an npc half the size on screen would otherwise wear twice as much of one — `PostProcessing` feeds `zoomProgress` to `syncNpcOutlineWidth` each frame |
| `relativeCut` | how much fainter the mask must be here than nearby to count as outside an npc |
| `depthBias`, `maskFloor` | guards, not tuning |

Cost whilst on: one extra attachment on the scene pass and the pick pass, and per post-pass pixel
13 mask reads (centre, 4 dilate, 8 ring) and 9 depth reads (centre, 8 ring).

## History

Tried twice and removed twice before this one; the write-up of those attempts is what this file
started as.

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

Neither removal records a reason; both are a bare `feat: remove npc outlines`.

### The one piece not brought back: per-npc colour

`r` carries coverage, leaving `gb` for a colour. `packOutlineColor` put the hue in as 3:3:2 bits
with its brightness riding alongside, rather than quantising the colour whole — a grey is then exact
whatever its value, where 3 bits of a dark grey would not be:

```ts
const brightest = Math.max(r, g, b, 1e-4);
const code = (round((r / brightest) * 7) << 5) | (round((g / brightest) * 7) << 2) | round((b / brightest) * 3);
out.set(code / 255, brightest);
```

Both are recovered as ratios against `r`, and whatever dimmed one dimmed all three alike, so the
colour that came back was the colour that went in however much stood in front. It rode in a uniform
(`outlinePack`), so `npc.setOutlineColor(color)` needed no material rebuild — exposed to the shell as
`w n.rob.setOutlineColor red`. In `getNpcOutline` the strongest neighbour won the colour, kept packed
until the end so only the winner was ever unpacked.

Bring it back with `git show 0ad34d55^:packages/ui/world/src/service/npc-outline.ts`. One thing there
is still worth knowing whatever the colour: the npc's mask write is **premultiplied against an alpha
of `1`** — a replace under the blend — because an arm passing over the torso writes the mask twice
and blending would sum it, which came out lumpy along every overlapping limb of a half-faded npc.
