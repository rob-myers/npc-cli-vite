# Npc skins

The ONLY doc for how npc skins get from source files to the GPU.

## Sources

`packages/app/public/skin` is a symlink to `packages/media/src/skin`:

- `{key}--{namemcUid}.png`: a 64px Minecraft skin, e.g. `ra-0--86403319024aa40f.png`
- `{key}.svg` (optional): an overlay drawn over it at 256px, i.e. the detail
  - a top-level `<g>` titled `meta foo=bar ...` becomes the skin's `meta` (e.g. `prefix`, `noEyes`, `overlay-backfaces`)
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
The server writes only those sent from loopback. A page reached by a network address over unsecured https drew
the D-class skins orange, their `mix-blend-mode` lost.

**In production** no skin png or svg is fetched: `w.texSkin` (256px, one layer per npc) is drawn
from `skin.{sheetId}.png` alone. So **load a World in DEV before committing**, else it is stale —
`.githooks/pre-commit` warns when a staged skin png or svg is newer than the sheets.

A DEV World redraws the sheets (the `["skins-and-gltf"]` query) on:

- every load
- an svg edit (`skinSvgsChanged`)
- a png edit, which reruns `gen-skin-sheets` (`skinSheetsRebuilt`)
- the **skins** button in WorldMenu's dev scripts, which reruns `gen-skin-sheets`

Only a browser renders the svgs faithfully: skia-canvas and resvg did not.

An npc holds its skin as an index into the sheet's entries. A new skin shifts the indices, so the World
remaps each npc by key when the skins change (`NPCs.tsx`).

## Making a skin

### Finding one

- Candidates come from namemc.com's tag pages, e.g. `/minecraft-skins/tag/robot`. Each `a[href^="/skin/"]` is a skin id.
- Cloudflare refuses curl there, so read them in a browser, e.g. Claude in Chrome. Fetch tags a few seconds apart, else 403.
- The texture itself downloads plainly: `https://s.namemc.com/i/{id}.png`.
- Show candidates front and back on a contact sheet, numbered, to choose from.
- A slim skin leaves columns 54–55 of the right arm and 46–47 of the left empty, so it is transparent at texel (54, 25).
  - Some fill them with junk instead, e.g. d-4's magenta and mint. So look at each arm too.
  - A slim skin taken as classic shows its arms a column off, the junk down their backs.
- A legacy skin is 64×32: make it 64×64 in the png itself, its left limbs the right ones flopped face by face.
- A starter svg is the meta group and its image alone, widened if slim.

### The png

- A 64px Minecraft skin with CLASSIC arms, 4px wide. The model has no slim (3px) arms. A slim skin's arms
  must be widened in its svg's embedded image, repeating each 3px face's middle column.
- No base face may have a transparent texel. The material discards it, leaving a hole, e.g. half an unwidened slim arm.
  Check the embedded image, or that the svg paints over the gap, as postdoc-0's does.
- Named `{key}--{namemcUid}.png`, with TWO hyphens. One hyphen and `rebuildSkinManifest` skips it with a warning.
- The key's prefix is its family: `spawn x as:mtf` takes the first skin whose key begins `mtf`.

### The svg

- `{key}.svg`, `viewBox="0 0 256 256"`: 4 units to a skin pixel.
- First a top-level `<g>` titled `meta prefix={family}`. In it is the png as an `<image>` 256 square, with
  `image-rendering: pixelated`, its `href` a data URI. Everything after it draws over the skin.
- A flag in that title becomes `meta`, e.g. `meta prefix=mtf noEyes`.
  - A bare word is `true`. A value after `=` is parsed as JavaScript, else kept as a string (`tagsToMeta`). So `x=0.5` is a number and `overlay-backfaces=head` the string `head`, but a value naming a global, e.g. `Math`, is that global.
- Avoid `<use>`. Boxy SVG re-saves each one as a full copy of what it names, the png included.
- Keep the `<title>`s: they are how a part is found in Boxy.

### What the model shows

- The OVERLAY layers render wherever they are opaque, as a shell a little outside the body. The npc
  material discards alpha under 0.9. So clear stray overlay pixels, and draw nothing part-transparent there.
- As in Minecraft, the overlay shows only its outer faces. A skin whose meta has `overlay-backfaces=head` shows the head overlay's four sides from within too, e.g. a crew cut's rim seen across the head (`d-5`).
  - Its npc's material is double-sided, and `shownFace` discards every other back face (`setOverlayBackfaces`, `service/npc-material.ts`). Other npcs' stay single-sided.
- The torso is three cuboids, chest, stomach and hips. Each one's top samples the body top, and each one's bottom
  the body bottom. A crouch bares them, so fill the body top and bottom.
- The head layer's unused corner, texels (0–8, 0–4), is sampled twice. The feet take (1–7, 0–4), and the torso overlay's tops and bottoms take all of it.
  - So anything opaque there shows at the seams between chest, stomach and hips, e.g. white lines (`d-4`).
  - Keep it transparent, as d-0's is. Then no feet are drawn.
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
- To clear texels with ImageMagick, copy a transparent patch over them: `( -size WxH xc:none ) -geometry +X+Y -compose Copy -composite`. `-region … -alpha transparent` leaves them.
- Widening slim arms, clear each arm's 16px square first. Else the old layout's overlay texels show through the new one's gaps.
- A screen for a face (`robot-2`, `robot-4`) is drawn near-black, its eyes in a bright core over a blurred glow. A dark grey screen reads faded in the World.
- Fine detail on a face, e.g. glasses (`medic-1`), goes on the head overlay as opaque strokes, its pixel original cleared. The eye slices never touch the overlay.
- Hair at the back of the head is drawn on the head overlay as tufts, never as one even plane, which reads as a raised panel (`d-4`).
  - The back takes pointed clumps of differing lengths, hanging from its top edge with gaps between. A crown covers the rear of the top face, its tips pointing forward. Each side takes a short clump at its rear.
  - The top face's upper edge meets the back. The right side's rear is its left edge, and the left side's is its right edge.
  - The base hair under them takes each tuft's blurred shadow just past its tips, and strand lines carrying on from the tufts'.
  - Drawn over a filtered image, they take the same filter (`#punch`), else their browns do not match.
- Short coily hair is small seeded coils on the head overlay, each a dark clump with a C-shaped curl, ending raggedly above a taper (`d-1`). The base beneath is the hair's colour with fine curls, and below a ragged edge it is skin, with stubble thinning out. It takes `overlay-backfaces=head`.
- Messy hair mixes the two layers (`d-2`).
  - The overlay takes short curved tufts of random size and mixed tones, each clipped to its face. On top they lie away from the crown, and elsewhere they hang down.
  - The base hair takes streaks along the same flow, clipped to its hair texels, and the tufts' blurred shadows.
  - A seeded random keeps it the same each time it is generated.
- A crew cut is a band of overlay hair round the rim of the head (`d-5`).
  - On the top face it is a narrow ring hugging the edge, half a texel to a texel wide, with a ragged inner edge. The base hair shows within it. It hangs a short way down the front, with a ragged lower edge.
  - Down the sides and back it hangs further, spiked, then breaks into flecks growing sparser with depth. That is how overlay hair dissipates, since anything part-transparent is discarded.
  - A full cap, or one notched along the rim, reads as a box.
  - Gradients give it form, darker toward the ragged edges. Fine short strokes texture it.
  - On the base, hair below the cap becomes skin, with stubble fading toward the neck.
- A beard is drawn on the head overlay, a darker copy on the base as its shadow, the lips on the base showing through its mouth (`postdoc-1`).
- Eyes are never too light, and brows never bold black. Mute an eye's white, darken its pupil, and draw the brows in a dark hair colour (`d-2`).
- Accessories and loose strands on the head overlay, e.g. clips, a knot, stray tufts, read as noise at this size. Remove them.
- Long hair below the head does not work, on the base or the overlay. Remove it from the body, each texel taking the nearest suit colour on its face (`d-4`).
- A D-class skin has a big D on its back, over a number made unreadable by `#worn`, and a chest patch with its own worn tag. Copy d-0's `inmate marks` group, changing the numbers.
  - On a white top they are dark, the patch's tag light (`d-3`).
  - A suit drawn on the body overlay too would hide them. Move them onto it, `translate(0 64)` (`d-5`).
- A blend layer paints a transparent texel in its own colour. So a clip, e.g. `suit-pale`, must cover only opaque texels: recompute it after any change to the image.
- A download may hide a watermark in its unused corners (`d-3`). Clear them, above all the base head's (0–8, 0–4).
- Small details drawn in texels read as low res, e.g. a stethoscope, a red cross, lapels, buttons or a speckled shirt (`medic-1`, `medic-2`, `medic-4`). Take them out of the embedded image, filling with the cloth beside them, and redraw them in the svg: smooth tones under the form shading, crisp shapes over it.
- Tattoos drawn in texels read as blotches. Take them out of the embedded image and redraw them as ink: strokes joining neighbouring tattoo texels within a face, dots for lone ones, clipped to the faces (`d-5`).
  - No stroke crosses an elbow or knee, at half a limb's height (texel row 26 for the right arm, 58 for the left). The halves are separate cuboids, so ink across the bend breaks as it bends.
- Wires and plates drawn in texels read as noise (`robot-3`). Flatten the chassis and plates to one colour each, redraw the wires as round strokes joining their texels within a face (a dark shadow, the wire, a thin shine), and bevel each plate's edges.
- Light cloth, e.g. a white coat or pale scrubs, takes form shading only, never a noise texture (`medic-{1..5}`). Each face, base and overlay, takes a gradient darker toward its bottom, its sides, back and underside darker than its front. A multiply group draws it, clipped to the cloth texels (opaque, light, not skin-toned).
  - A texture, if wanted, goes over the form shading, faint: fold creases and a fine weave, each a filtered rect clipped to the cloth, at a quarter to a third opacity (`medic-3`).
  - White and pale blue still reading too light takes darker lines, not darker colours (`medic-2`). A multiply group of 1px strokes, unclipped, draws a firm seam where one colour meets another within a face, a lighter line round each face's edges, and a few folds at knees and elbows. One grey reads as dark blue on the blue and as grey on the white.
  - A gamma or scale filter darkening pale cloth turns it another colour, e.g. pale cyan into teal. Avoid it when the colour is the point.
  - Put `mix-blend-mode` on the clipped group itself. A clip isolates the group, so children blending inside it see an empty backdrop, and paint grey.
- A skin needing only a little form takes one subtle multiply group over every face of its body and limbs, base and overlay, clipped to their opaque texels (`form-body`), and a lighter one over its head (`form-head`), as `ra-{1,2}` and `postdoc-{1,2}`.
- Bare skin takes d-0's per-face shading (its `suit` group), which gives limbs their form. Leave a dark skin out of the contrast filter, which crushes it to black (`d-3`).
- A D-class suit is grey, whatever the download's colour. It is greyed (`saturation`), darkened (`multiply`) and blotched (`#blotches`), as d-0's is, all clipped to its own suit texels (`suit-pale`, a rect per run).
  - A pale download reads faded beside d-0 and d-1. Raise its contrast and saturation by a filter on its `<image>` (`#punch`), and darken its suit's multiply, e.g. `#707070` (`d-4`).
- A face is shaded as d-0's is, over its own features: darker toward its sides, under the fringe and at the chin. A pale face takes d-0's front spotlight faintly, else it is blown out (`d-4`).
- Medic-0's head shading reads well on most skins: a hard-light spotlight over the face and top of the head,
  and the sides and back a little darker.

### Checking

- The dev server rebuilds `manifest.json` on any skin png or svg change. A DEV World redraws the sheets.
- Check an svg written by hand or script with `xmllint --noout`. One that does not parse is not drawn.
- Spawn the skin next to the player, in `sight`, to see it lit as it will be.
- jsh `debug_skins rob` spawns one npc per skin in a circle about rob, facing them, named e.g. `mtf1`. `as:mtf` keeps one family, `r:2.5` widens it.
- Load a DEV World before committing, so `sheet/skin.N.png` and `sheet/skin-slices.N.png` are current.
- The dev server saves a sheet only when what it is drawn from changes: its layout, its skins' sources and meta, or the drawing code (`skin-sheet-hash.ts`). The hash is kept in the png. So another browser's rendering never rewrites it.
- It saves only from this machine, over http. A self-signed https page (`USE_HTTPS`) may draw them wrongly when certificate invalid.
