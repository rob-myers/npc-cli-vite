# Symbol generation

How to write a symbol's MapEdit JSON by hand, from its png, without drawing it in MapEdit. Also how to
place those symbols in a hull symbol (a geomorph), and give it the walls and doors it lacks. The ONLY doc
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
   The earlier project has many of these already: `~/coding/npc-cli-next/media/symbol/*.svg` gives each
   room's optional doors, and each `{NNN}--hull.svg` the transform of every symbol in that geomorph, at
   5 times the scale. A `transform-origin: 50% 50%` there turns about the box's centre.
3. Measure the png. Nothing is committed for this: a throwaway node script over `skia-canvas` (in
   `scripts/node_modules`) is enough to flood-fill a region and trace its contour.
4. Build the JSON and save it with `pnpm dev` running:
   `POST /api/map-edit/file/symbol/{key}.json`, the body being the file. This validates it, writes it
   compact, draws `{key}.thumbnail.png` and updates `manifest.json`. The dev server then rebuilds
   `assets.json`.
5. Read the thumbnail. It draws every node over the faint png, so a misplaced door or chair shows.
6. Run `pnpm gen-starship-sheets`, AFTER `assets.json` has caught up: run straight after the save, it
   misses the new obstacles.
7. Check `assets.json` still has all seven top-level keys, `theme` and `hash` last. See Pitfalls.

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

- **Walls**: four `rect`s named `wall`, each 4 thick, running across any door. A wall the parent may
  already supply is `wall optional e`, added only by a parent's `walls=['e']`.
- **Doors**: a `rect` over the drawn door, 8 by 45, named e.g. `door e slide=[0,-1]`. Each is followed
  by its two `decor quad key=switch` images, one each side of the wall, beside the door.
- **Optional doors**: a room is reused where its doors differ, so give it one per side it could have,
  each `door {n|e|s|w} optional`. A parent's `doors=['e','w']` keeps those sides and walls up the rest;
  `doors=[]` keeps none. With no `doors` tag every door stays.
- **Optional sub-symbols**: the same for furniture a parent may not want. Tag the `symbol` node
  `optional` and with a group, e.g. `console--051 y=0.4 optional seats`. A parent's `symbols=['seats']`
  keeps that group, `symbols=[]` keeps none, and no `symbols` tag keeps all. The symbol's own key works as
  a tag too. A hull symbol's own optional sub-symbols always stay, having no parent to choose.
- **Windows**: a tiled strip along a wall is a window, not a shelf. Leave that wall out of the room and
  let the parent place `window--005` (120 long) or `window--007` (180 long) over it.
- **Label**: `decor point label=office`, a `label` decor at half scale, or `label=medical` on the door.
- **Sub-symbols**: a `symbol` node, its name carrying the height e.g. `console--051 y=0.5`. Prefer one
  that exists: `console--051` is the armchair, `extra--003--chair` the small chair,
  `extra--010--machine` the COMP unit, `extra--001--fresher` a basin, `extra--002--fresher` a toilet,
  `counter--010` a sink set in a counter, `extra--018--table` a round table and
  `couch-and-chairs--006` a sofa with its end tables. Rotate it about its centre by the node's `transform`.
- **Obstacles**: a `rect` or a `path`, named e.g. `obstacle table surface y=0.7`, or
  `obstacle y=1 h=0.7 tint=#444 skirtTint=#777` for machinery.
- **Heights add.** A parent's `y` is added to the obstacle's own. So furniture a parent will place by
  height carries none itself: the shops are `obstacle machine tint=#555 skirtTint=#555`, placed `y=0.8`.

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

## Placing symbols in a hull symbol

A hull symbol, e.g. `g-302--xboat-repair-bay.json`, is 1200 wide on the same units, and its png is NOT
upscaled: 1 px per unit. Its image node's `cssTransform` gives the png's origin, so a point in the art
is its pixel plus that, e.g. minus `(4, 62)` in g-302.

- **Add to the `symbols` group**, one `symbol` node each, named with its tags:
  `office--006 doors=['e','w']`, `shop--031 y=1`.
- **The transform is a plain matrix** from the symbol's own origin: no transform-origin. A quarter turn
  clockwise of a room at `(x0, y0)` is `(0, 1, -1, 0, x0 + height, y0)`; a half turn
  `(-1, 0, 0, -1, x0 + width, y0 + height)`; a mirror in x `(-1, 0, 0, 1, x0 + width, y0)`.
- **Start from the earlier project** where it has the geomorph. Divide its translations by 5. Where a
  `use` has `transform-origin: 50% 50%`, the matrix turns about the OLD box's centre: keep that centre
  and re-centre our symbol on it, since our sizes differ slightly from the old ones.
- **Then fit to the art**, which wins. `window--007` sat 9 units high by the old numbers.
- **`offset`** is the child's `bounds` origin turned by the matrix; `baseRect` its manifest size.
- **Check by overlay.** A hull symbol's thumbnail draws no images. Draw the hull png, then each child's
  png in a colour through its `cssTransform` at a scale of 0.2, and look at it.
- **The art may not match the symbol.** The lounge of g-302 has `lounge--015`'s fresher but not its
  furniture. Place it and say so; do not delete what was placed by hand.

## A hull symbol's own walls and doors

Whatever the placed rooms do not enclose is drawn in the hull symbol itself. Measure it off the art by
reading runs of dark pixels along a row or column.

- **Walls** go in a `walls` group as `rect`s named `wall`, as thick as drawn (4 thin, 8 thick), each
  running across its doors.
- **Doors are appended AFTER the hull doors.** A door's id below the hull-door count is what marks it as
  one, so the `door hull edge=…` rects stay first.
- **A door onto vacuum is `door sealed`**, not `hull`: a hull door needs an `edge` to join the next
  geomorph. `locked` and `auto` are the other door tags read.
- **A solid block** e.g. a fuel tank is a `path` named `wall no-fill broad` round its outline, with a
  `poly ceil fill=#5551 stroke=#333 strokeWidth=4` on top. The ceiling is a PARALLEL inset of that
  outline: move each edge in by the same distance and intersect neighbours. Insetting by eye leaves the
  diagonals closer than the rest, and the line reads uneven.
- **Labels** are `decor point label=…`, one per room that has none from a placed symbol; quote one with
  a space, `label='repair bay'`.
- **Left for a person**: a door lying along a slanted wall. Whether a rotated door rect works is untested.

The layout in `assets.json` says whether it worked: `layout[key].rooms` goes up as rooms close.

## Pitfalls

- **`assets.json` can be cut short.** `safeJsonCompact` once dropped everything past 100,000 values,
  which lost `theme`, `hash` and part of the last layout once enough symbols existed. The cap is lifted
  (`maxValues: Infinity`), but a dev server started before such a fix keeps the old code: restart it.
- **A broken `assets.json` does not heal.** An incremental rebuild that cannot parse the file starts
  from empty, keeping only the changed files. Run `pnpm gen-assets-json --force`.
- **A rebuild from empty loses the themes**, which live only in `assets.json`. Restore `theme` from
  `git show HEAD:packages/app/public/assets.json`, then rebuild once more.
- **A parent used to lag one save behind a child.** The symbols' dependency levels were only worked out
  when a symbol was CREATED, so a parent given a new sub-symbol stayed on its old level and was
  flattened before it. `gen-assets-json` now works the levels out on every run.
- **Do not run `gen-assets-json` whilst the dev server is doing so.** A burst of saves starts one each.
- **MapEdit may hold the file.** After saving through the api, reload the file in MapEdit before
  saving there, or its copy overwrites the new nodes.
