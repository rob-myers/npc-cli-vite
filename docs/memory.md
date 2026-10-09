# Memory

Where the World's memory goes, what has been saved, and what could be. The ONLY doc for it.
Figures are from the dev page on `large-map` (9 geomorphs, 3 keys) on 2026-10-09.

| file | what |
| --- | --- |
| `ui/world/src/service/tex-array.ts` | `TexArray`: every texture array, its CPU mirror and its 2D canvas |
| `ui/world/src/components/World.tsx` | where the arrays are created, and their starting sizes |
| `ui/world/src/const.env.ts` | the `MAX_*` caps that size them |
| `ui/world/src/service/room-slots.ts` | the room-slot array, one layer per geomorph INSTANCE |

## Where it goes

Chrome's memory tab showed about 730 MB. Half of that is memory the app allocates in JavaScript:

| where | MB |
| --- | --- |
| main thread: typed-array buffers | 213 |
| main thread: JS objects and code | 127 |
| jsh worker | 15 |
| physics worker | 7 |

The rest is outside what the page can measure: decoded images, 2D canvases, WebGPU's client-side
buffers, and Chrome's own baseline with DevTools open. The GPU's copy of every texture is in another
process again, and is not in that figure.

Of the JS heap, 47 MB is the parsed assets and layouts (1.8 million objects) and 24 MB is compiled
code. A further 49 MB of source text is the dev server's, and a build does not carry it.

## A texture array costs three times

A `TexArray` can hold the same pixels in three places:

- **the GPU texture**, plus a third more with mipmaps (`anisotropy` above `1`);
- **a CPU mirror**, `tex.image.data`, the same size, which three.js uploads from;
- **a 2D canvas**, one layer in size, which each layer is drawn on first.

At the floor's size, 3030 x 3030, one layer is 35 MB in each. So the count of layers, and which of the
three an array really needs, is most of the story.

## Done

- **The floor is one layer per geomorph KEY**, not per instance, as the ceiling's always were. On
  `large-map` that is 3 layers where it would have been 9. See `docs/floor.md` for what that rules out
  drawing on it.
- **A `gpu` array has no CPU mirror.** The floor, ceiling and obstacle sheet are filled by copying
  their canvas on the GPU, so the mirror was never sent anywhere, yet was allocated at full size:
  267 MB on `large-map`. `createMirror` now gives `null` for them, and three.js sizes the texture from
  its dimensions. The mirror is only made if such an array has to read its canvas back after all.
- **The floor and ceiling arrays are sized to the map** before each draw. They used to stay at 3 and 2
  layers, and a bigger map wrote past the end.

## Not done yet

In order of what they would save on `large-map`:

| what | saving | how |
| --- | --- | --- |
| npc skins and labels | 80 MB, and as much on the GPU | Both are allocated for `MAX_NPCS` (256) up front. Grow them as npcs are added. |
| the obstacle sheet's image and canvas | about 90 MB | Needed only whilst the sheet is drawn. Release both after the upload. Unmeasured: it is in the half the page cannot see. |
| room slots | up to 40 MB | Allocated for `MAX_GEOMORPH_INSTANCES` whatever the map, and as four channels where two are read. Size it to the map. |
| door labels | 16 MB | A fixed 32 layers of 256 x 512. |

Room slots are the only large thing that grows per geomorph INSTANCE, at 5.6 MB each. So raising
`MAX_GEOMORPH_INSTANCES` is cheap. A new geomorph KEY costs a floor and a ceiling layer: 70 MB on the
GPU, or 93 MB with their mipmaps. The two canvases, 35 MB each, are shared by every key.

## Measuring

Chrome's memory tab gives one total. To see what is in it:

- **The arrays**, from a console or the MCP's `query`. Each `w.tex*` is a `TexArray`:
  `tex.image.data?.byteLength` is its mirror, `ct.canvas.width * ct.canvas.height * 4` its canvas, and
  `opts.width * opts.height * 4 * opts.numTextures` its GPU size before mipmaps.
- **The heap and the buffers**, over the debug port the MCP uses (`NPC_MCP_CDP_PORT`, default `9382`):
  `Runtime.getHeapUsage` gives `usedSize` and `backingStorageSize`, the typed arrays' own memory.
  `performance.memory` in the page counts only the first.
- **The workers**, by `Target.setAutoAttach` with `flatten: true` and the same call on each session.
- **What the buffers are**, by `HeapProfiler.takeHeapSnapshot`: total `self_size` by node name, and
  list the nodes over a few MB. A big `system / JSArrayBufferData` is one mirror.

Measure after a fresh load. A `TexArray` made before an edit keeps its old mirror across a hot reload,
and hot reloads leave old modules behind in the heap.
