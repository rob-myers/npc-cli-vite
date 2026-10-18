# Skin slices

The ONLY doc for skin slices and the eyes drawn with them: what a slice is, how the eyes are found and
drawn, how they reach the GPU, and jsh `pose`.

## In short

A SLICE is a face-sized piece of texture that the npc shader draws over a skin's face. Each skin has a
grid of them, and each holds that skin's eyes, whole, one way they can be: half shut, shut, looking up,
and so on. An npc's eyes are ONE uniform, the slice it shows.

Nothing is drawn by hand. A dev-server script finds each skin's eyes, and a DEV World draws every
slice from the skin's own face.

Eyes are apart from poses and clips. Nothing sets them but `setEyes` and `blink`, and a walk keeps them.

## Finding the eyes

`detectSkinEyes` (`scripts/src/service/skin-eyes.ts`) reads a skin's 64px png and looks in the 8x8
face front for:

- **whites**: grey pixels, with **pupils** what is neither skin nor white beside them on their rows, e.g. a pale iris;
- failing those, **inverted eyes**: a coloured iris with dark on every side, the eye being both (robot-0);
- failing those, **dot eyes**: whatever else is dark (medic-0).

It only looks in the left half, below the hairline and off the face's edge, at pixels their mirror matches.

It gives the LEFT eye as seen, the right being its mirror, as `meta.eyes` in `skin/manifest.json`:

```json
{ "open": [1, 5, 2, 2], "pupil": [2, 5, 1, 2] }
```

Each is `[x, y, width, height]` in the face's 8 pixels: where the eye opens, and the pupil within it.
A dot eye has the same rect for both. A skin whose eyes it does not find has no `meta.eyes`, and its
eyes never change. Nor does one whose svg meta says `noEyes`, e.g. a masked face: it is not looked for.

`rebuildSkinManifest` calls it, so it runs when the dev server starts, on a skin png or svg change,
and in `gen-skin-sheets`. Its thresholds are `tune` in that file, set on the skins there are.

## The frames

`eyeFrames` in `const.both.ts` names what each slice holds, in order. A frame's index is its slice.

| Frame | How it is drawn |
|---|---|
| `open` | nothing: the face as it is |
| `half` | skin over the top half of the opening, its lower edge dark. An inverted eye's lid is outlined in the eye's dark instead |
| `shut` | the same, over all of the opening |
| `up`, `left`, `right` | the opening all white, then the pupil moved 2 texels, cut off at the opening |
| `scared` | the opening grown up to 2 texels each way, to 8 by 10 at most, and pale grey, with a smaller pupil. An inverted eye keeps its dark |
| `none` | skin over the opening |

`drawEyes` in `service/skin-sheets` draws them, both eyes at once, with numbers from `eyeDraw` beside it.
Every colour is the face's own:

- **skin** is the texel beside the eye, towards the nose, on the same row;
- **white** is a column of the eye's own white. A dot eye has none, so skin shows where its dot was.

A new frame is a name appended to `eyeFrames` and a line in `drawEyes`.

## Sizes

`skinSliceDims` in `const.both.ts`:

- `slice`: 32px, the face front at a skin's 256px.
- `cell`: 128px, a skin's 4x4 grid of slices, so 16 of them.
- `maxSkins`: 32, the layers of `w.texSkinSlices`.

`gen-skin-sheets` has its own copy of the cell size (`npcSlicesCellSize`). Change both together.

## Sheets

This follows the skin sheets (`docs/skins.md`).

- `pnpm exec gen-skin-sheets` only lays them out: a cell per skin in `sheets.json` (`skinSlices` by
  skin key, `skinSlicesSheetDims`).
- **In DEV** the World draws each sheet itself (`loadSkinSliceSheets` in `service/skin-sheets`), from
  the skin sheets it has just drawn, so the eyes take the skin svg's shading. Each sheet is POSTed to
  `/api/skin-slices-sheet/:sheetId`, where the dev server writes `public/sheet/skin-slices.{sheetId}.png`.
- **In production** the slices are drawn from that png alone. So **load a World in DEV before committing**,
  as for skins.

## The texture array and loading

`w.texSkinSlices` is a `TexArray` of 128x128, nearest-filtered, with a layer per SKIN at the skin's
index in `w.texSkin`. So a material's `skinIndexUniform` picks its slices too. It has a fixed 32
layers and is never resized, since the materials read the texture it was made with.

The slices load with the skins, in the `["skins-and-gltf"]` query in `NPCs.tsx`, and the memo that
draws each skin into `w.texSkin` draws its cell into `w.texSkinSlices`. A skin svg change in DEV
redraws both.

## The shader

In `createMaterials` (`NPCs.tsx`): where a fragment is on the face front, the slice `npc.eyesUniform`
picks is sampled at the same place on the face and laid over the skin by its alpha. That is all.

## Looks

`npc.anim.setEyes(look)` takes a frame's name, or `shifty`, which steps between `left` and `right`.
`npc.anim.blink(count)` steps through `half`, `shut`, `half` that many times, then shows the look again.
Nobody blinks unasked. The steps and their timing are `eyesConfig` in `const.npc.ts`.

`tick` calls `tickEyes` only whilst `anim.eyes.busy`: blinking, or shifty. Eyes are not persisted: a
reload opens them.

## Seeing them

The **Skins** debug modal shows each skin's face under every frame, by name, beneath its skin.

## jsh

`pose npcKey [as:pose] [at:npcKey] [eyes:look] [blink:count]`

`eyes:` and `blink:` need no `as:`, and alone they return at once.

```sh
pose rob eyes:shut
pose rob eyes:shifty
pose rob eyes:none
pose rob eyes:open blink:2
pose rob as:point at:kate eyes:scared
```
