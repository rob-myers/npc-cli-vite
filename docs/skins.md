# Npc skins

The ONLY doc for how npc skins get from source files to the GPU.

## Sources

`packages/app/public/skin` is a symlink to `packages/media/src/skin`:

- `{key}--{namemcUid}.png`: a 64px Minecraft skin, e.g. `human-0--23aa3d70ee53af87.png`
- `{key}.svg` (optional): an overlay drawn over it at 256px, i.e. the detail
  - a top-level `<g>` titled `meta foo=bar ...` becomes the skin's `meta` (e.g. brightness)
  - a `<g>` titled `ignore` is dropped when rasterised

`manifest.json` there lists them (`byKey`, with `svgPath` and `meta`), rebuilt by `rebuildSkinManifest`.
Its `meta.eyes` is where the skin's eyes are, found in the png: see `docs/skin-slices.md`.

`spawn` takes a skin by key or prefix, e.g. `spawn rob at:[2,0,3] as:r`: the first skin whose
key begins with it (`w.npc.findSkinKey`), an exact key first, else `w.npc.defaultSkinKey`.

## Sheets

`pnpm exec gen-skin-sheets` only lays them out: one **256px** cell per skin, written to `sheets.json`
(`skin`, `skinSheetDims`). It draws nothing.

**In DEV** the World draws each sheet itself (`service/skin-sheets`): per skin its svg, else its png,
nearest-neighbour. Those canvases feed `w.texSkin`
directly, and each is POSTed to `/api/skin-sheet/:sheetId`, where the dev server writes
`public/sheet/skin.{sheetId}.png` and runs `pngquant` on it — written only if its pixels changed.

**In production** no skin png or svg is fetched: `w.texSkin` (256px, one layer per npc) is drawn
from `skin.{sheetId}.png` alone. So **load a World in DEV before committing**, else it is stale —
`.githooks/pre-commit` warns when a staged skin png or svg is newer than the sheets.

A DEV World redraws the sheets (the `["skins-and-gltf"]` query) on:

- every load
- an svg edit (`skinSvgsChanged`)
- a png edit, which reruns `gen-skin-sheets` (`skinSheetsRebuilt`)
- the **skins** button in WorldMenu's dev scripts, which reruns `gen-skin-sheets`

Only a browser renders the svgs faithfully: skia-canvas and resvg did not.

## Making a skin

### The png

- A 64px Minecraft skin with CLASSIC arms, 4px wide. The model has no slim (3px) arms. A slim skin's arms
  must be widened in its svg's embedded image, repeating each 3px face's middle column.
- Named `{key}--{namemcUid}.png`, with TWO hyphens. One hyphen and `rebuildSkinManifest` skips it with a warning.
- The key's prefix is its family: `spawn x as:soldier` takes the first skin whose key begins `soldier`.

### The svg

- `{key}.svg`, `viewBox="0 0 256 256"`: 4 units to a skin pixel.
- First a top-level `<g>` titled `meta prefix={family}`. In it is the png as an `<image>` 256 square, with
  `image-rendering: pixelated`, its `href` a data URI. Everything after it draws over the skin.
- A flag in that title becomes `meta`, e.g. `meta prefix=soldier noEyes`.
- Avoid `<use>`. Boxy SVG re-saves each one as a full copy of what it names, the png included.
- Keep the `<title>`s: they are how a part is found in Boxy.

### What the model shows

- The OVERLAY layers render wherever they are opaque, as a shell a little outside the body. The npc
  material discards alpha under 0.9. So clear stray overlay pixels, and draw nothing part-transparent there.
- The torso is three cuboids, chest, stomach and hips. Each one's top samples the body top, and each one's bottom
  the body bottom. A crouch bares them, so fill the body top and bottom.
- The feet sample texels (3–4, 2–4), in the head layer's unused corner.
- The rest of the template's unused corners are never drawn.

### Where each face is

In skin pixels, as `[x, y]` of a face's top-left corner. Multiply by 4 in the svg. Faces are 4 wide on a limb, the head's 8.

| part | top | bottom | right | front | left | back | overlay |
| --- | --- | --- | --- | --- | --- | --- | --- |
| head | 8,0 | 16,0 | 0,8 | 8,8 | 16,8 | 24,8 | 32 to the right |
| body | 20,16 | 28,16 | 16,20 | 20,20 | 28,20 | 32,20 | 16 down |
| right arm | 44,16 | 48,16 | 40,20 | 44,20 | 48,20 | 52,20 | 16 down |
| right leg | 4,16 | 8,16 | 0,20 | 4,20 | 8,20 | 12,20 | 16 down |
| left arm | 36,48 | 40,48 | 32,52 | 36,52 | 40,52 | 44,52 | at 48,48 |
| left leg | 20,48 | 24,48 | 16,52 | 20,52 | 24,52 | 28,52 | at 0,48 |

- Faces of a part lie side by side as they wrap round it: right, front, left, back.
- A top's lower edge meets the front's upper edge.
- The body is 8 wide and 12 tall; a limb is 4 by 12. A limb's upper and lower halves are separate cuboids, so a knee or elbow is at half height.

### Eyes

- The eyes are found in the png, in the face front, as whites with pupils beside them — see `docs/skin-slices.md`.
- The eye slices are drawn from the RENDERED face. So leave the eye row alone, and the skin texel beside each eye.
- A face that should never blink, e.g. a masked one, takes `noEyes` in its meta.
- Check `meta.eyes` in `manifest.json` once the dev server has rebuilt it.

### Detail

- Draw at the svg's resolution, not the png's. A shape there is four times finer than a skin pixel, which is
  how a pixel visor becomes goggles, or a pixel helmet a smooth one.
- To change pixels themselves, e.g. recolour a suit, remove a stray braid or fill a transparent face, change
  the embedded image rather than painting over it.
- Medic-0's head shading reads well on most skins: a hard-light spotlight over the face and top of the head,
  and the sides and back a little darker.

### Checking

- The dev server rebuilds `manifest.json` on any skin png or svg change. A DEV World redraws the sheets.
- Spawn the skin next to the player, in `sight`, to see it lit as it will be.
- Load a DEV World before committing, so `sheet/skin.N.png` and `sheet/skin-slices.N.png` are current.
