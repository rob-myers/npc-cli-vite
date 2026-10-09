# Symbol generation

How to write a symbol's MapEdit JSON by hand, from its png, without drawing it in MapEdit. The ONLY doc
for it. Where a save goes is `docs/map-edit.md`; obstacle sheets are `docs/starship-sheets.md`.

| file | what |
| --- | --- |
| `media/src/starship-symbol/const.ts` | `symbolByGroup`: the key must be listed here first |
| `media/src/starship-symbol/output/{group}/{key}.png` | the source art |
| `app/public/starship-symbol/{key}.png` | the same art, as MapEdit and the sheets read it |
| `app/public/symbol/{key}.json` | the symbol, a `MapEditSavedFile` |
| `ui/map-edit/src/editor.schema.ts` | `MapNodeSchema`: the node shapes |
| `ui/world/src/service/geomorph.ts` | `parseSymbolFromSavedFile`: what a node's name means |

## Steps

1. List the key in `symbolByGroup`. If its png is not yet in `app/public/starship-symbol`, run
   `pnpm starship-pngs-to-public`.
2. Look at the png, and at how the geomorph art uses the room. A geomorph can differ from the symbol's
   own art: `medical--008` has its door on another wall in g-101.
3. Measure the png. Nothing is committed for this: a throwaway node script over `skia-canvas` (in
   `scripts/node_modules`) is enough to flood-fill a region and trace its contour.
4. Build the JSON and save it with `pnpm dev` running:
   `POST /api/map-edit/file/symbol/{key}.json`, the body being the file. This validates it, writes it
   compact, draws `{key}.thumbnail.png` and updates `manifest.json`. The dev server then rebuilds
   `assets.json`.
5. Read the thumbnail. It draws every node over the faint png, so a misplaced door or chair shows.
6. Run `pnpm gen-starship-sheets`, AFTER `assets.json` has caught up: run straight after the save, it
   misses the new obstacles.

## Units

A png is 5 px per unit, so a node's `baseRect` is the png's size divided by 5. Rooms sit on a grid of
60: `width` and `height` are multiples of it e.g. 120 x 180, 180 x 240. A machine with no walls takes
the png's own size, e.g. `machinery--155` is 104 x 220.

A wall is 4 thick and centred on the room's edge, so the png is placed with its wall centres on `0`
and on `width` / `height`. That makes the image node's `transform` slightly negative, e.g. `(-2, -2)`,
or `(-4.8, -2)` where doors stick out to the west. The file's `bounds` is the image node's rect.

## Nodes

The first node is the locked `image` of the symbol's own png. The rest go in groups named `symbols`,
`obstacles`, `doors` and `walls`. A node's NAME is its tags.

- **Walls**: four `rect`s named `wall`, each 4 thick, running across any door.
- **Doors**: a `rect` over the drawn door, 8 by 45, named e.g. `door e slide=[0,-1]`. Each is followed
  by its two `decor quad key=switch` images, one each side of the wall, beside the door.
  `optional` lets a parent drop it by `doors=[]`, as `medical--007` and `medical--008` are used.
- **Label**: `decor point label=office`, a `label` decor at half scale, or `label=medical` on the door.
- **Sub-symbols**: a `symbol` node, its name carrying the height e.g. `console--051 y=0.5`. Prefer one
  that exists: `console--051` is the armchair, `extra--003--chair` the small chair,
  `extra--010--machine` the COMP unit. Rotate it about its centre by the node's `transform`.
- **Obstacles**: a `rect` or a `path`, named e.g. `obstacle table surface y=0.7`, or
  `obstacle y=1 h=0.7 tint=#444 skirtTint=#777` for machinery.

A `symbol` or `image` node also has an `offset`, and `cssTransform` is `transform` plus it. Only
MapEdit and the thumbnail read those two; the World reads `transform`. For a sub-symbol, `offset` is its
own `bounds` origin turned by the node's rotation.

## Obstacle polygons

An obstacle's top is its polygon cut out of the png, so the polygon decides what art is kept.

- **Include the drawn border.** Trace the OUTSIDE of the outline, not the fill within it. A grey fill
  traced as is loses its line: grow the mask by the line's width (7 px for a thin line) before tracing.
- **Stop at a wall's inner face.** Grow the mask inside the room only, so a table does not take wall art.
- **Just enough points.** Simplify the traced contour (about 3 px of tolerance), which leaves a curve
  as a few straight runs: a quarter circle wants four or five, not twenty.
- **Square the corners.** A rounded stroke leaves a short chamfer at each corner. Replace it with the
  corner where its two neighbours meet, which also keeps the border.
- **A rect where a rect will do.** A `path` is for a shape that is not one.

A machine with no walls is one polygon round its silhouette: every opaque pixel.

## What a tracer needs

- Classify each pixel: transparent, dark (line or wall), or light (grey fill).
- Flood-fill from a seed over one class to get a region's mask.
- Optionally grow the mask by a square of `R` px, clipped to a rect.
- Follow the mask's outer edge to a closed polygon, simplify it, square its chamfers.
- Divide by 5 and add the image node's `transform`.

Dark connected components give the bounding boxes of doors, chairs and lettering, which is enough to
place rects and sub-symbols.
