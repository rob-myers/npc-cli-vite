# Npc skins

The ONLY doc for how npc skins get from source files to the GPU.

## Sources

`packages/app/public/skin` is a symlink to `packages/media/src/skin`:

- `{key}--{namemcUid}.png`: a 64px Minecraft skin, e.g. `human-0--23aa3d70ee53af87.png`
- `{key}.svg` (optional): an overlay drawn over it at 256px, i.e. the detail
  - a top-level `<g>` titled `meta foo=bar ...` becomes the skin's `meta` (e.g. brightness)
  - a `<g>` titled `ignore` is dropped when rasterised

`manifest.json` there lists them (`byKey`, with `svgPath` and `meta`), rebuilt by `rebuildSkinManifest`.

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
