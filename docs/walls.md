# Walls

Walls, the lintels over doors, and how tall each is. Drawn by `components/Walls.tsx`: one instanced
mesh of translucent quads, two-sided geometry drawn `FrontSide`, `renderOrder` 4, writing no depth.

## Heights

| What | Where | Now |
| --- | --- | --- |
| A wall | `wallHeight`, `const.env` (and its copy in `worker/physics.ts`) | 1.8 m |
| A door | `doorHeight`, `const.env` | the wall's, less 1 mm |
| A lintel | `lintelHeight`, `const.env` | 0.1 m, hung over the door's top |
| A door's depth | `doorPanelDepth`, `const.env` | 0.12 m, a hull door 0.24 m |

A door is a little deeper than the walls either side (faces ±0.05 m, a hull's about ±0.1 m), so it
stands out of them.

## A wall of its own height: `meta.y`, `meta.h`

A `wall` node's tags may give it its own base and height, e.g. `wall y=0.4 h=1.4`: from `meta.y` up,
`meta.h` tall, else from the floor to `wallHeight`. No symbol uses them yet. `Walls` draws them
(`getWallMat`, and the `wallHeight` instanced attribute its bands are measured off), but most else
takes a wall as full height:

- **Sight** (`spot-sight`, `sightOccluders`) and **the player light** (`player-light`, every
  `wallSegs` segment) let nothing past a wall, however low or raised. A wall to see over would need
  them to read its height, as obstacles' `meta.h` is read.
- **Spots** take every wall segment as a wall to stand against (`spots.ts`).
- **Its top** (`Ceiling`, `gmsData.tops.nonHullWall`) is drawn only for a wall reaching `wallHeight`:
  no `h`, or `y + h === wallHeight` with both given.
- **The floor's skirt edge** (`drawSkirtEdges`) skips a raised wall (`y > 0`), which never meets it.

## Bands

A wall is darker along its foot and its top, `wallBandHeight` (0.2 m) each, at `wallBandDarken` (2)
times its opacity. Drawn in the wall's own colour, so walls of one colour blend alike in any order:
they write no depth, and are not drawn back to front. A band of another colour, or a separate band
mesh, showed through nearer walls (`WallSkirts`, `WallTrims`, both gone). The lit edge along a wall's
foot is drawn into the floor instead: `deckConfig.skirt` in `docs/floor.md`.

## Lintels

Two per door, from `getLintelSegs` in `service/DerivedGmsData.ts`, kept apart from `wallSegs` as
`gmData.lintelSegs`. So the light sweep, room slots, spots and skirt edges never take one for a wall.

- Each hangs `lintelHeight` down from the wall's top, as a wall with `meta.y = wallHeight -
  lintelHeight` and `meta.h = lintelHeight`.
- One stands just in front of each face of its door (half `doorPanelDepth`, plus 2 mm), facing out of
  the doorway. An open door slides away behind them.
- `Walls` draws each geomorph's lintels after its walls (`count.lintel`), and `decodeInstanceId`
  gives a picked one its `doorId`.
- One shows with either of its door's rooms, read live, as a door's `roomIds` are known only once the
  World has built. A missing side is never shown.
- No taller than a band, a lintel is drawn wholly at the band's opacity.
