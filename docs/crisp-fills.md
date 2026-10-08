# Crisp fills

For a canvas whose pixels are read back as ids, not looked at. The ONLY doc for it.

| file | what |
| --- | --- |
| `util/src/service/canvas.ts` | `drawPolygonsCrisp`, beside `drawPolygons` |
| `ui/world/src/service/DerivedGmsData.ts` | the room-hit canvas: `findRoomIdContaining` |
| `ui/world/src/service/room-slots.ts` | the room-slot texture: `rasterise`, `roomAt` |

## The problem

A 2D canvas softens the edge of every fill, and nothing switches that off: `imageSmoothingEnabled` is
for `drawImage` alone, and a composite mode only decides how a part-covered pixel combines.

Where one opaque fill is drawn over another, the edge pixel is a BLEND of the two colours. If a colour
is an id, the blend is a third id, or none. It has bitten twice:

- **Room slots.** Two rooms' codes blended into a third room's: a one-texel line along every shared
  wall, drawn whenever that third room was in view.
- **Room-hit canvas.** A door is `(100, 0, doorId)` and a room `(200, roomId, 0)`. Half and half is red
  150, which is a window's. So a row of pixels each side of every door decoded as a bogus window or as
  nothing, `findRoomContaining` returned `null` there, and `w.e.raycast` threw `dst must be in a
  room/doorway`. An armed npc read that as a wall ahead and drew their phaser in, walking through an
  open door.

## The fix

`drawPolygonsCrisp(ct, polys, { fillStyle })` fills as `drawPolygons` does, with hard edges.

1. The polygon is drawn alone on a scratch canvas, under `ct`'s own transform. Alone, its edge can
   only blend with transparency.
2. A pixel is the polygon's if at least half covered (alpha 128 or more).
3. Those pixels of `ct` are overwritten with `fillStyle` whole. The rest are left as they were.

Only the polygon's bounding box is read and written. `fillStyle` must be opaque. Later polygons win
where two cover the same pixel, as with any fill.

## When to use it

Whenever a canvas is DECODED: a pixel's colour names a room, a door, a slot. Use `drawPolygons` for
anything only seen, where the soft edge is wanted.

Do not patch the reader instead, e.g. by trying a pixel's neighbours, or by choosing colours no blend
can match. Both were tried on the room-hit canvas and reverted: the canvas should hold no wrong pixel.

## Checking it

Read the whole canvas back. Every pixel should be fully transparent or fully opaque, in one of the
colours painted. For the room-hit canvas that is red 100, 150 or 200 only: the debug view
"Room Hit Canvases" shows it, and a seam shows as a line darker than the door beside it.
