# Npc scenarios

Scenarios in which two or more npcs interact in three or more ways, directed by queries over spots (`docs/spots.md`) and live npc state. Each is a probe: it forces queries and actions we can reuse.

A query becomes an interaction when it is asked again, on a tick or an event, and its npcs act on the change.

| Scenario | Npcs | Status |
| --- | --- | --- |
| [Hide and seek](#hide-and-seek) | a seeker, 2-3 hiders | not started |
| [Guard and intruder](#guard-and-intruder) | 2 guards, an intruder | not started |
| [Meeting in secret](#meeting-in-secret) | 2 conspirators, a watcher | not started |
| [Breach and clear](#breach-and-clear) | a squad of 3, those inside | not started |

## Hide and seek

1. **Scatter.** Each hider takes a spot the seeker's spot does not see, preferring cover or a doable. It avoids spots another hider holds or sees.
2. **Search.** The seeker walks to the spot that sees the most spots it has not yet seen. Each spot it then sees is marked seen.
3. **React.** A hider the seeker's next spot would see crouches, if cover hides it from there (`crouchHidden`). Else it sneaks to a spot neither the seeker's spot nor its next one sees.
4. **Found.** Once the seeker sees a hider, it looks at them and says "found you". That hider then searches too.

Queries: `sees`, `crouchHidden`, spots in reach, spots held by npcs, an npc's room and facing.

## Guard and intruder

1. **Post.** The guards take an overwatch pair: two spots which between them see every door of a room, and see each other.
2. **Slip through.** The intruder goes door to door through spots neither guard sees. It waits whilst a guard faces its way.
3. **Alert.** A guard who sees the intruder tells the other, in a speech bubble. The other moves to a spot that sees the intruder's way out.
4. **Standoff.** The guards raise their phasers. The intruder hides behind cover from the nearer guard, or gives up, and both guards walk to them.

Queries: pairs of spots, `seesDoors`, `seesVia` with open doors, a route through spots, facing, who sees whom.

## Meeting in secret

1. **Choose a place.** Two spots, near each other and in sight of each other, that the watcher's spot does not see. Doables are preferred, so they sit and talk.
2. **Arrive apart.** Each takes a route the watcher does not see, and they arrive at different times.
3. **Lookout.** Whilst one talks, the other stands at a spot that sees the door the watcher would come through.
4. **Scatter.** When the watcher heads for a spot that sees them, the lookout warns the talker. They leave by different doors to spots hidden from the watcher, then walk calmly back to their posts.

Queries: spots near doables, pairs in sight of each other, the watcher's room and heading, `seesDoors`, spots hidden from the watcher.

## Breach and clear

1. **Stack up.** One door spot each on the near side of the room's door, close together, and hidden from the inside (`seesVia`).
2. **Entry.** The door opens. The first npc takes the corner spot that sees most of the room, and the second the opposite corner. Neither crosses the other's line of sight.
3. **Clear.** Spots no squad member sees yet, e.g. behind obstacles, are each sent the nearest free member. An npc found inside is told to sit or crouch, with psi or the phaser raised.
4. **Hold.** Once every spot of the room is seen by someone, one member watches the door and the rest gather.

Queries: spots by side of a door, coverage (the union of `sees`), the spot seeing most, the nearest free npc, a room's spots.

## Queries they share

- **Npc to spot:** `spotOf(npc)`, and their room and facing.
- **Sight between spots:** `sees`, `seesVia` given which doors are open, `seesDoors`, `crouchHidden`.
- **Sets of spots:** in reach or in a room, coverage, not yet seen, held by other npcs.
- **Picking:** nearest, most new coverage, pairs that meet a condition.
- **Live checks:** who sees whom now, and a reaction when it changes.
