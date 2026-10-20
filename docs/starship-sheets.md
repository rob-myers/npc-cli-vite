# Starship symbol sheets

How obstacle tops get their image: one spritesheet rect per obstacle polygon, drawn onto an instanced quad.

| file | what it holds |
|---|---|
| `scripts/src/bins/gen-starship-sheets.ts` | packs and draws the sheets, writes `sheets.json`'s `symbol*` fields |
| `ui/world/src/assets.schema.ts` | `SheetsSchema.symbol`, `StarShipSymbolSheetEntrySchema`, `getObstacleSheetKey` |
| `ui/world/src/service/geomorph.ts` | `createLayout` — each layout obstacle keeps `symbolKey` + `obstacleId` |
| `ui/world/src/components/Obstacles.tsx` | `addUvs` — sheet rect to per-instance UVs; `draw` — sheets into `w.texObs` |

Outputs: `packages/app/public/sheet/symbols.{sheetId}.png` and the `symbol`, `symbolSheetDims`,
`maxSymbolSheetDim` fields of `packages/app/public/sheets.json`.

## What gets packed

Every obstacle polygon of every **unflattened** symbol in `assets.symbol` — `sym.obstacles[obstacleId]`
as drawn in MapEdit — gets its own rect:

- `srcRect` = the polygon's bounds, relative to the symbol's top-left, in the symbol png's pixels.
- The png scale is `worldToSguScale * (hull ? 1 : 5)` (`getSymbolPngScale`) — hull pngs are not upscaled.
- Packed at `ceil(srcRect.width) x ceil(srcRect.height)` with `packedPadding: 8`, max 4096².

**`dup`**: MapEdit `obstacle y=0.8 window dup={y:1.7,top:true}` (no spaces inside the braces) makes
`parseSymbolFromSavedFile` append a copy with `meta` extended by `dup` and `meta.dupOf` = the original's
`obstacleId` — e.g. a window's bottom and top. The copy gets no rect of its own: `addUvs` reads its original's.

Drawing each rect: clip to the polygon, `drawImage` just `srcRect` from the symbol png (or its
`starship-symbol/replace/{key}.png` override), then apply `starship-symbol/mask/` remove/colour polys
**inside the same clip** — rects are packed tight, so an unclipped mask would paint a neighbour. The whole
sheet is then inverted (alpha kept) and squeezed with `pngquant`.

**Mask SVGs** (`starship-symbol/mask/{symbolKey}.svg`, drawn in Boxy SVG) must keep the symbol's original
image size (no scaling down), with offsets matching the symbol in `assets.json` — e.g. `bridge--042` has a
large one. Transformed rects/polys are not supported: convert to a shape if needed, then Transform > Reduce.

- **Coordinates** are symbol units times 5. The `viewBox` is the symbol's `width`/`height` times 5, and
  the png's `<image>` sits at its `bounds` origin times 5, e.g. `x="-10"` for `bounds.x = -2`.
- **Lettering inside an obstacle shows on its top**, so mask it out. Examples are HOLO on `lab--018`'s table
  and COMP on `engineering--047`'s machine. Give each letter a `mask color={fill}` path round its outline
  grown by a few px, in the colour around it: `white` on a table, the machine's own grey (sample the png,
  e.g. `rgb(205,205,205)`). Lettering on the floor needs nothing, as the floor is not drawn from pngs.

## `sheets.json` entries

```ts
sheets.symbol[getObstacleSheetKey(symbolKey, obstacleId)] // "{symbolKey} {obstacleId}"
  = { symbolKey, obstacleId, sheetId, rect }
```

`rect.x/y` is the integer top-left in the sheet; `rect.width/height` is the obstacle's EXACT fractional pixel
size. So `addUvs` is just `rect / maxSymbolSheetDim` — no scale on the client. It is the MAX, not
`symbolSheetDims[sheetId]`: `draw` puts every sheet at the origin of a layer as big as the largest, so a
smaller second sheet's UVs would otherwise land too far across. The quad itself is
sized by `origPoly.rect` in `createObstacleMatrix4`, so the image fills it exactly.

Several scripts write `sheets.json` (decor, skin, starship). Each keeps the others' sections by parsing
the previous file first. `gen-starship-sheets` parses it **without** its own `symbol` section
(`SheetsSchema.omit({ symbol: true })`), because a strict parse falls back to `emptySheets` on any
mismatch — which once wiped the skins and made every npc vanish.

## Refreshing after a MapEdit change

- `pnpm gen-starship-sheets`, or the **obstacles** button in WorldMenu's dev scripts (POSTs
  `/api/gen-starship-sheets`, then invalidates `["sheets"]` and `["obstacle-images"]`).
- It reads `public/assets.json`, so let the automatic `gen-assets-json` (on MapEdit save) finish first.

Until then the layout is ahead of the sheet, and entries are keyed by **index**:

| change in MapEdit | until you refresh |
|---|---|
| add an obstacle | no entry — warned per instance, top invisible |
| resize or move one | the old crop stretched over the new rect |
| delete or reorder | every later obstacle of that symbol shows the wrong crop |
