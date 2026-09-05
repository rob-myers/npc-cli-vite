# Floor

Everything about how the floor is drawn. Nothing about it lives in another doc.

| file | what it holds |
|---|---|
| `service/texture.ts` | `deckConfig`, `drawRoomFloors`, the wiring router, the grates, the plate pattern, `softEdges` / `toEdgeOpts` |
| `components/Floor.tsx` | `drawGm` — the draw order, the nav mesh, the hull, and the `floorShading` flag |
| `util/service/canvas.ts` | `drawPolygons`, `getPolysPath`, `drawBlurredEdge` |
| `components/Debug.tsx`, `service/storage.ts`, `components/WorldMenu.tsx` | the `floorShading` flag |

The floor is one `DataArrayTexture` layer per `gmId`, **3030² at 100 px/m**, drawn with canvas 2D in
world metres (`ct.setTransform(worldToCanvas, …)` in `startGm`, so the canvas y-axis runs opposite
the world's — text and anything else with a handedness has to be flipped back).

## `deckConfig` — the one place to tune

The look is deliberately quiet: a flat tone, square plates of decking with a seam and a rivet at
each corner, a line held off each room's walls, a bright conduit bundle in some rooms, small
metallic grates in others, and the nav mesh over the top. All of it comes from **one
mutable object**, `deckConfig` in `service/texture.ts`. Change a value from the console and call
`w.floor.drawAll()`; the plate pattern notices and rebuilds itself.

```ts
deckConfig.plate.seamWidth = 0.05;
deckConfig.rivet.shown = false;
deckConfig.wiring.rooms = "all";
deckConfig.grate.max = 8;
deckConfig.nav.ink = "rgba(255,120,120,0.2)";
w.floor.drawAll();
```

Seven parts: `tone`, `plate`, `rivet`, `outline`, `wiring`, `grate`, `nav`. Each of the last
five but `nav` has a `shown` flag that turns it off outright. Lengths are in METRES.

`wiring` and `grate` are the two that read a room's **label** — `wiring.rooms` and `grate.rooms`,
each a list of labels or `"all"`. Nothing else on the floor is label-driven.

`wiring` is a bundle of conduits — one line per colour in `wiring.inks`, on a dark backing, with
clamp brackets across them. Add or remove an ink to change the count; the bundle stays centred on
its route, so it widens evenly either side.

The route **follows the room's own walls**, `wallOffset` inside them, from `geomService.createInset`
— so it turns exactly the corners the room turns, which a straight line through the bbox cannot do
in an L-shaped room. `roundRing` then rounds each corner by `bendRadius` and samples the whole ring
at `sampleStep`, giving a point list with an outward normal each — **outward is found by probing the
room polygon**, not from the ring's winding, since `createInset` need not hand back the room's own
and getting it backwards points every normal into the room. Points within `doorClearance` of
any of the room's doors are dropped, breaking the ring into runs — **conduit never crosses a
threshold**.

Each loose end is then turned into the wall by `withEntries`, and **meets it square**. Sliding the
bundle sideways over the last stretch cannot achieve that: however it is eased, the wire still
arrives travelling ALONG the wall — a cosine ease is worst of all, since its derivative at the end
is zero. So the last `diveLength` of each run is replaced by a cubic whose tangent at the wall IS
the wall's normal (`diveTension` sets how hard that turn is pulled square). The conduits keep their
full offsets round it, so the bundle turns as one ribbon and enters the wall side by side rather
than gathering to a point. Clamps skip any point with `entry: true` — there is nothing flat there to
clamp to.

A room whose ring never comes near a door keeps the whole loop, unbroken and with no entries.

`wiring.rooms` is the one thing that reads a room's **label** — the `meta.label` of its labelled
decor point, gathered in `Floor.drawGm` the same way `RoomLabels` gathers it (`helper.isRoomLabel`
over `w.decor.byKey`, where `Decor`'s ready pass has already resolved `meta.gmId` / `meta.roomId`).
Set it to `"all"` for every room, or list labels. Nothing else on the floor is label-driven.

**Beware how few rooms a label can name.** `common` names exactly ONE room in the whole asset set
(`g-101--multipurpose` room 14, 8.9 × 10.5 m); `g-301--bridge` has none at all, so on a 301 map the
default `rooms: ["common"]` draws nothing anywhere. Use `"all"` when tuning the look.

The theme keeps only `floor.hullFill`, the structural ground between rooms that `drawHullFloor`
paints. The deck laid on top of it is `deckConfig`, so there is one place to tune, not two.

`grate` puts metallic grates into the deck — a bevelled plate, grating bars, a lit bolt at each
corner — over whatever electronics live under it. They are drawn **deliberately loud**: a bright
`fill` against the deck's `tone`, a strong bevel and a bold lead, so they are easy to pick out at
playing distance. Each sits **near a wall** (between `wallClearance` and `wallBand` of the room's
outline) and is **turned to lie along** that wall, its long side parallel to it, which `nearestWall`
settles from the closest edge.

`placeGrates` picks the spots by rejection sampling from a hash of `<gmKey>:<roomId>`, so a redraw
puts them back exactly where they were. `perArea` and `max` set how many are wanted, then `attempts`
candidates are tested for: **every corner** on the deck (not just the middle, or one hangs off the
inside corner of an L-shaped room), `doorClearance` from any threshold, `spacing` from each other,
`wireClearance` from the room's own conduit, and `obstacleClearance` from every obstacle footprint —
a grate under a table cannot be seen, so it is not worth placing.

**Every grate has a straight lead** running out of it into the nearest wall — never a doorway,
because a wire crossing a threshold is the one thing the conduit is at pains to avoid. Because the
lead goes to the *closest* point on the outline, it already meets that wall at a right angle,
straight out of the grate. Having nowhere to run it is therefore a reason not to place the grate at
all, rather than a grate without one.

The lead must clear the obstacles too — `segmentHitsRect` (Liang-Barsky, so exactly rather than by
sampling) rejects any target it would reach only by disappearing under one.

The lead **may** cross the room's conduit, and runs under it. That is why `placeGrates` only picks
the spots and the drawing is the caller's: `drawRoomFloors` lays the leads down first, draws the
conduit over them, then the plates over the ends of their own leads. The `wireClearance` test still
applies to the plate — a grate does not sit ON the bundle, it only passes beneath it.

Because the grates must clear the conduit, `drawRoomFloors` routes the wiring **once** and hands the
same `RunPoint[][]` to both — a room set to carry both features would otherwise draw them over each
other. It likewise transforms the obstacle footprints once for the whole layout rather than per room,
and each room takes only the ones its bounds reach.

## Draw order (`Floor.drawGm`)

Hull fill and its 45° hatch → wall bases (`#000`) → `drawRoomFloors` → broad-wall aliasing fix →
nav mesh → door shadows → the blurred edges, if `floorShading` → obstacle drop shadows → the debug
grid, if `gridShown`.

## Floor shading — the soft dark edges

Rooms and doorways each wear a soft dark edge, drawn INTO the texture rather than shaded per
fragment. Under the **"Floor Shading"** row in `WorldMenu`'s debug list, persisted as `floorShading`
and read by `drawGm` off `w.debug`. Toggling it redraws the floor — nothing about it reaches a
shader.

A stroke, blurred, clipped to the shape it traces — the clip keeps the inner half of the line and
throws the outer half away, which is an inner shadow:

```ts
export function drawBlurredEdge(ct, clipTo, edge, { blurPx, lineWidth, strokeStyle }) {
  ct.save();
  ct.clip(clipTo instanceof Path2D ? clipTo : getPolysPath([clipTo]));
  ct.filter = `blur(${blurPx}px)`;
  … stroke(edge) …
  ct.restore();
}
```

Two passes, and `clipTo` and `edge` differ because the second needs them to:

1. **Rooms** — each room's whole outline, doorway openings included, clipped to itself.
2. **Doorways** — the rooms and their doorways unioned into one `walkable` shape, whose outline runs
   THROUGH each doorway rather than across it, stroked once and clipped to the doorway polygons. The
   sides of a doorway are what should darken; its openings should not. One pass over the lot rather
   than one per doorway, each of which would blur and walk that whole outline again.

There used to be a third, an inner shadow on every floor panel. It went with the panels themselves.

## Things worth knowing

- **A seam is two lines.** A dark groove plus a lit lip just beyond it (`plate.seamInk` /
  `plate.lipInk`). That pair is what makes a join read as recessed metal instead of a drawn line.
  The rivets and the wiring channel follow the same rule, all lit from the upper-left.
- **Keep every feature at least two texels wide** — 0.02 m at 100 px/m. A sub-pixel line is
  antialiased into a smear whose coverage depends on where it falls, so where an axis-aligned nav
  edge lies along a seam the two beat against each other as the camera moves.
- **`texFloor` needs `anisotropy`.** A `DataArrayTexture` is nearest-filtered with no mipmaps by
  default (`TexArray.applyOpts`), which on a deck of hairlines is that flicker again, worse.
  `texCeil` is the same 3030² and already asks for it. It stays off on touch devices, so there the
  two-texel rule is the only defence.
- **A doorway is not a room.** The deck reaches the bulkhead, so `layout.doors[].poly` has to be
  decked too or `hullFill` shows through between the decks either side. **Windows do not** — they
  are cut out of the nav mesh, so at floor level a window is wall.
- **Nav mesh: dedupe the edges.** An interior edge belongs to two triangles, so stroking each
  triangle in turn draws it twice, which reads as patchy rather than as a mesh. `Floor.drawNavMesh`
  builds one `Path2D` of faces and one of distinct edges — two calls instead of thousands.
- **Never infer "outward" from a winding.** Canvas y runs downward, so the shoelace sign means the
  opposite of what it does in maths convention, and an offsetting routine need not preserve the
  input's winding anyway. Probe the polygon with `contains` instead — it is a handful of samples and
  it cannot be wrong. Getting this backwards is why the wiring first dived away from the wall and
  ended in mid-air.
- **`ct.clip` INTERSECTS.** `drawPolygons(ct, polys, { clip: true })` calls it once per polygon, so
  clipping to several that way leaves you their intersection — usually nothing. Build one `Path2D`
  instead, which is what `getPolysPath` is for.
- **`ct.filter` blurs in CANVAS pixels** whatever the transform, whilst `lineWidth` is in user
  units. Only the blur needs converting — that is all `toEdgeOpts` exists for, and forgetting it
  leaves the blur either invisible or enormous.
- **Blur follows the clip, not the path.** A blurred draw costs roughly its clipped area. The
  doorway pass is the one to watch: its clip is small but its path spans the geomorph.
- **`gm.rooms[i].meta` is empty `{}`** — rooms are the holes of a `Poly.union`, so there is no
  `room.meta.label` to read. Anything room-scoped joins via the labelled decor point.

## Cost

All of it is in `drawGm`: once per geomorph on map load, on `w.hash`, or on `decor.ready`, with an
existing `pause()` between geomorphs. Nothing is per frame. With `floorShading` off there is not a
single filtered draw, and it also skips the `Poly.union` for `walkable` — the heaviest CPU item in
the group, ~62 polygons through polygon clipping per geomorph.

## History

Built first as a deck material per room chosen from its label, with per-class plating, tiling and
weave, plus per-label tints and inlays — a roundel for `common`, a chart rose for `cartography`, and
so on. In the world, under the player light and at playing distance, almost none of it was legible;
the nav mesh was the only thing you could make out. Stripped back to this, with `wiring` the one
survivor that still reads a label — and it only became visible once it stopped being a recessed
groove in the deck's own inks and became brightly coloured conduit lying on top of it.

Earlier still, `0aa50fa7 feat: tweak room outlines + decided against room/room-outline shadow blur`
records the decision to drop the shading, not the code, which was never committed. It came back
behind the debug flag so the two looks could be compared. Things tried and not kept, all of which
read worse than a plain doorway: filling the doorway with the shadow ink, hatching it, and hatch
plus a rectangular outline.
