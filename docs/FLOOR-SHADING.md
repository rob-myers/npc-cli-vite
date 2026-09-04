# Floor shading — the soft dark edges

Rooms, doorways and floor panels each wear a soft dark edge, drawn INTO the floor texture rather
than shaded per fragment. Under the **"Floor Shading"** row in `WorldMenu`'s debug list, persisted as
`floorShading` and read by `Floor.drawGm` off `w.debug`. Toggling it redraws the floor
(`w.floor.drawAll()`) — nothing about it reaches a shader.

| file | what it holds |
|---|---|
| `util/service/canvas.ts` | `drawBlurredEdge`, `getPolysPath` |
| `service/texture.ts` | the `softEdges` numbers, `toEdgeOpts`, the per-panel shadow, `getRoundedPolyPath` |
| `components/Floor.tsx` | the room and doorway edges, and the flag |
| `components/Debug.tsx`, `service/storage.ts`, `components/WorldMenu.tsx` | the debug flag |

## The mechanism

A stroke, blurred, clipped to the shape it traces — the clip keeps the inner half of the line and
throws the outer half away, which is an inner shadow:

```ts
export function drawBlurredEdge(ct, clipTo: Geom.Poly | Path2D, edge: Geom.Poly | Geom.Poly[] | Path2D,
  { blurPx, lineWidth, strokeStyle }) {
  ct.save();
  ct.clip(clipTo instanceof Path2D ? clipTo : getPolysPath([clipTo]));
  ct.filter = `blur(${blurPx}px)`;
  … stroke(edge) …
  ct.restore();
}
```

`clipTo` and `edge` are separate because the doorway pass needs them to differ — see below.

## Three passes

1. **Rooms** (`Floor.drawGm`) — each room's whole outline, doorway openings included, clipped to
   itself. After the flat `rgba(0,0,0,0.7)` dim, so it darkens again at the walls.
2. **Doorways** (`Floor.drawGm`) — the rooms and their doorways unioned into one `walkable` shape,
   whose outline runs THROUGH each doorway rather than across it, stroked once and clipped to the
   doorway polygons. The sides of a doorway are what should darken; its openings should not. One
   pass over the lot rather than one per doorway, each of which would blur and walk that whole
   outline again.
3. **Panels** (`drawRoomOutlines`) — an inner shadow on every floor panel, so it reads as raised
   rather than painted on. The ROUNDED path for `whole` panels, or the shadow traces sharp corners
   the fill does not have — hence `getRoundedPolyPath`, split out of `fillRoundedPolys` so the fill
   and its shadow are the same path.

## The numbers

```ts
export const softEdges = {
  roomEdge:    { width: 0.15, blur: 0.015, ink: "rgba(0, 0, 0, 0.45)" },
  outlineEdge: { width: 0.12, blur: 0.04,  ink: "rgba(0, 0, 0, 0.4)"  },
};
export function toEdgeOpts({ width, blur, ink }) {
  return { blurPx: blur * worldToCanvas, lineWidth: width, strokeStyle: ink };
}
```

`toEdgeOpts` exists for the one thing that catches everybody: **`ct.filter` blurs in CANVAS pixels
whatever the transform**, whilst `lineWidth` is in user units. Only the blur needs converting, and
forgetting to leaves it either invisible or enormous depending on the scale.

## Other things learnt the hard way

- **`ct.clip` INTERSECTS.** `drawPolygons(ct, polys, { clip: true })` calls it once per polygon, so
  clipping to several polygons that way leaves you with their intersection — usually nothing. Build
  one `Path2D` instead, which is what `getPolysPath` is for.
- **Blur follows the clip, not the path.** A blurred draw costs roughly its clipped area, which is
  why ~250–300 panel shadows are cheaper than they look: each clips to one grid piece. The doorway
  pass is the one to watch — its clip is small but its path spans the geomorph, so an implementation
  sizing the filter surface from path bounds alone would blur the full canvas. Four draws, so even
  then it is bounded.
- **Curved rooms are left whole** (`isCurved` in `texture.ts`): a grid of rectangles inside a curved
  room reads as a mistake, all the more so once each panel wears its own shadow. That rule outlived
  the shading itself and is in the tree regardless.

## Cost

All of it is in `drawGm`: once per geomorph on map load, on `w.hash`, or on `decor.ready`, with an
existing `pause()` between geomorphs. Nothing is per frame. For a 4-geomorph map at 3030² and 100
px/m that is roughly 300–350 filtered draws in total, ~85% of them panel shadows.

Off, there is not a single filtered draw: the flag skips the `Poly.union` for `walkable` too, which
is the heaviest CPU item in the group (~62 polygons through polygon clipping, per geomorph).

## History

Written, then removed at the end of a long session on the floor's look — `0aa50fa7 feat: tweak room
outlines + decided against room/room-outline shadow blur` records the decision, not the code, which
was never committed. Restored later behind the debug flag, so the two looks can be compared rather
than chosen once. Things tried and NOT restored, all of which read worse than the plain doorway:
filling the doorway with the shadow ink, hatching it, and hatch plus a rectangular outline.
