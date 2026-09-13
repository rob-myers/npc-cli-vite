# Npc debug notes

Findings from chasing npc movement bugs, kept so the next one starts further along.

## An npc orbits another npc standing on their target

**Seen as**: `pick | move npc:rob` and `pick | spawn` running together. Each pick spawns an npc
and sends rob to the same point, and rob circles the newcomer without ever arriving.

**Simpler reproductions**: `move` one npc onto a point where another is standing, or `move` two
npcs to the same point. The pick case is also order-dependent: the pick fans out to both
pipelines, so the spawn may land before or after the move starts.

### Why

- Arrival is `isAgentAtTarget(crowd, agentId, getArriveDistance(npc))` in `NPCs.onTick`. Walking,
  that radius is `npcConfig.dist.arrive.walk` = 0.15 m. Agents are `agentRadius` = 0.18 m, so with
  another npc on the target the closest rob's centre can get is about 0.36 m. The test can never
  pass.
- Within `agent.radius * 2` of the target the update flags switch to `arrivingUpdateFlags`:
  separation without avoidance. The occupant shoves rob away at separation's fixed speed whilst
  the steering pulls him back in. That tug of war is the orbit.
- `updateStuck` counts frames with under `stuckEpsilon` of movement. An orbiting agent moves
  plenty, so it never counts as stuck and the move never rejects.

### Suggestions

1. **Arrival that allows an occupied target.** At the arrival check, if another agent's centre is
   within two radii of `agent.targetPosition`, treat being within two radii plus a small margin as
   arrived. Covers the target becoming occupied mid-walk, which the fan-out case is. Rob stops
   beside the newcomer and idles. Fixes the case on its own — but arriving somewhere else is a
   lie; rejecting the move as stuck was preferred, see (3).
2. **Retarget an already-occupied destination in `move`.** If the destination is within two radii
   of another npc, aim at the nearest free point on the circle around them instead, clamped to
   the navmesh via `getClosestPoly`. He then walks to stand next to them rather than trying for
   the centre, which reads as intended rather than tolerated. `spawn` already refuses an occupied
   doable; this is the moving-side counterpart.
3. **Progress-based stuck detection.** Track the closest he has got to the target. If that has not
   improved by more than a small epsilon for `stuckDuration`, reject the move as stuck, or arrive
   if already within a few radii. Catches any orbit or jam that motion-based detection misses,
   e.g. two npcs circling a doorway. **Done**: `updateStuck` answers `"circling"` once no nearer
   for `stuckDuration`, and only then `NPCs.onTick` tests the neighbours (`isTargetOccupied`),
   rejecting the move as stuck if one stands on the target.

### On using `agent.neis` for (1)

`agent.neis` is the neighbour list the crowd builds each update, and it looks like the right
thing to read, but in navcat 0.4.1:

- It is **not sorted**. Detour inserts neighbours by distance; navcat pushes them in grid-walk
  order. `neis[0]` is whoever was met first.
- `dist` is the **squared** distance, despite the name, and includes `y`.
- Only agents within `collisionQueryRange` appear — 0.7 m in `getAgentParams` — which is enough
  for an arrival check, since rob is within 0.36 m of the occupant by then.

So rather than `neis[0]`, walk `neis` and test each `crowd.agents[agentId].position` against
`agent.targetPosition`: occupied if any is within two radii of it. Cheap, since the list is a
handful at most.
