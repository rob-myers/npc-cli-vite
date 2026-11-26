# Npc placement

Where the World puts an npc: on spawning, onto and off doables, apart from one another, and into rooms with a limit. Parked and padded npcs are jsh state, in `docs/acts.md`.

## Spawning

- `state.placeNpcAt(npc, closePolyResult, override?)` places or teleports an npc. Found on the navmesh, they get an agent. Else their agent is removed, as on a seat off the navmesh.
- `w.npc.spawn` throws `not placable` first for a point off it that is not a doable, or one whose nearest navmesh point is across a wall, in another room.

## Doables

- A seat or bed point with `meta.front-only` (e.g. a sofa's) is taken and left only from in front (`w.e.frontOf`). From behind, they walk round to it, or step off forwards, rather than fade. One doable to another is free.
- **Getting up** (`w.e.stepOff`, and jsh `act`'s `getUp`) lands on the spot beside the doable least blocked from it, the cheapest of those (`besideDoable`, `leastBlocked`): nothing between, else another obstacle, e.g. a desk, else a wall or shut door. Nowhere in their room, outside its door (`w.e.closestExitFrom`). At a doable on the navmesh they are let go where they stand. In a full room, either way, they fade out of its door.
- A fade onto or off a doable never passes another obstacle, only its own, e.g. its chair (`canFade`, `passesOther`, `w.e.obstacleKeyOf`). Walking up to one, they stop beside it as getting up lands.
- A move onto a doable with nowhere beside it fades on from outside its room's door, not from wherever they are.
- Already beside the doable, e.g. just stepped off the chair next to it, they skip the walk up and fade on (`moveOntoDoable`). A walk that short would never arrive.
- An edit that takes a doer's decor puts them back on a free doable within `reseatMetres` (0.25m), i.e. the one nudged. Else they stand up where they are (`w.e.standUpStrandedDoers`).

## Pinning and overlap

- An npc at a doable on the navmesh, e.g. a sink's `do=stand`, is hard pinned (`npc.setHardPin`, set by `setNpcDo`). Neither the crowd nor a shove moves them, and sidestep leaves them be.
  - Walking off it, they turn along their way first (`turnBeforeMoving`'s `always`).
- An idle npc is only pinned softly (`pinTo`), so two spawned on top of one another slide apart.
- The crowd parts them only to its radii (0.4m), where bodies still meet.
  - Idle within `dist.overlap` (0.5m) for `overlapDuration`, one shuffles off to `overlapClear`: whoever came to rest later, the player too (`updateIdleOverlap`, the `npc-overlap` event, `w.e.shuffleClear`).
  - It fires once per spell, and any move overrides it, e.g. sidestep's.
  - It never cuts into a fade, nor a `move` of theirs yet to settle, e.g. between stepping off a doable and walking on (`w.e.hasPendingMove`, `pendingMoves`).

## Max walkers

A room's first label may set `max-walkers=N`, read once into `maxWalkers` on its `w.gmRoomGraph` node. Its doors are in `w.gmRoomGraph.walkerRooms`.

- At most N stand on its navmesh (`w.e.admitWalker`). Those at a doable don't count, unless it has `meta.as-walker`, e.g. a shower's (`do:as-walker` on its symbol instance).
- A full room's door areas are refused to others, as a locked door's (`w.e.refusesWalker`, from `canPassNode`).
- Anyone else fades between outside its door (`w.e.closestExitFrom`) and a doable within `doableLook` (1.5m) of it, either way. For a doable further in, they walk up to its door, then fail `room full`. Leaving for a point just outside, e.g. in its doorway, they fade straight onto it.
- Between its doables they hop, at most `doableLook` each, e.g. toilet, toilet, sink, then out.
- A walk onto its floor is refused as at a locked door: it stops outside and fails `room full` (`docs/doors.md`). So do `spawn` and `warp` onto it.
- Refused, they shake their head (`w.e.roomFull`, which gives the error).
