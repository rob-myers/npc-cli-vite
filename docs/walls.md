# Walls

Walls, the lintels over doors, and how tall each is. Drawn by `components/Walls.tsx`: one instanced
mesh of translucent quads, two-sided geometry drawn `FrontSide`, `renderOrder` 4, writing no depth.

## Heights

| What | Where | Now |
| --- | --- | --- |
| A wall | `wallHeight`, `const.env` (and its copy in `worker/physics.ts`) | 1.8 m |
| A door | `doorHeight`, `const.env` | the wall's, less 1 mm |
| A lintel | `lintelHeight`, `const.env` | 0.1 m, hung over the door's top |
| A door's depth | `doorPanelDepth`, `const.env` | 0.101 m, a hull door 0.201 m: just proud of its walls |

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

## Hull walls by a hull door

A hull wall is never shown in fade mode (`neverShownSlot`): it is the ship's outside, with nothing behind it.
By a hull door it is inside the ship, e.g. a column between two doors, or a doorway's side. `Walls` shows a
hull segment whose midpoint is within 0.1 m of a hull door with that door's room (`setSegSlots`).

## Obstacles poking into a wall

An obstacle may be moved into a wall, e.g. a toilet, to widen its room's navmesh. Walls can be
see-through (`theme.walls.opacity`), so `Obstacles` clips it at its room's edge, through
`service/obstacle-clip.ts`. One wall per obstacle, or two meeting at a corner of the room, e.g. a sink run into one.

- **Which.** One with a corner outside its room's polygon (`clipOf`). The cut is the room's edge
  nearest the furthest-out corner. Another corner past an edge from the same corner of the room adds that
  wall too, if the room is convex there. A window's sill (`meta.window`) and a doorway's floor plate
  (`meta.floor`) span openings, so they are never clipped.
- **Kept** in `clipTex`, a float texture of `(cx, cz, a1, a2)` by instance id, filled by `buildInstanceIds`:
  a point, and the outward angles of the walls through it. One wall repeats its angle.
  It is a texture rather than an attribute: the skirts have no vertex buffer to spare.
- **Drawn.** Both materials read it (`insideClipBy`), by the nearer wall, and drop what lies past the cut (`maskNode`). A
  top whitens within `cutLineWidth` of it.
- **A black back.** Its own back skirt lies past the cut, so it is dropped with the rest, leaving a hole.
  `transformAndColorSkirts` adds a skirt across each cut instead (`clipBacksOf`, its outline clipped by
  each wall), facing into the room. It is plain black (`#000`), not panelled, as the obstacle's inside would be.
- **Cost.** One texel fetch and two dot products per pixel, clipped or not. One more skirt instance per wall
  an obstacle is cut at. No draw calls.
