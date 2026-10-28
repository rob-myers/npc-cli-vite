# Inventory

What an npc has, and the bar that shows the player's. The ONLY doc for it.

| file | what |
| --- | --- |
| `ui/world/src/components/WorldHud.tsx` | the bar, `w.hud` |
| `ui/world/src/components/use-world-events.ts` | what is carried, `w.e.carried`, and held keys |
| `ui/world/src/service/storage.ts` | `carried` (per World), `PersistedNpc.access` (per map) |
| `ui/world/src/const.env.ts` | `inventoryConfig`: kinds, heights, reach, the most carried |
| `cli/src/jsh/world/core.ts` | `give`, `drop`, `inventory` |
| `media/src/decor/{phaser,book,box,keycard}.svg` | an item's one textured face, as decor |
| `media/src/icon/*-icon.svg` | its drawing in the bar, imported as `itemIconUrl` from `@npc-cli/media/icon` |

The player sets out with psi and a phaser: `defaultWorldSettings.carried`, for `defaultPlayerKey`. A World
saved before has what it was left with.

## The bar

The bar sits at the bottom centre of a World, and a slot is pressed. A net client has none, as neither psi
nor phasers are mirrored.

| slot | shows | a press |
| --- | --- | --- |
| psi, `q` | faded unless granted; its neurons fire whilst on | `w.player.togglePsi()` |
| phaser, `e` | faded unless carried; its emitter lit whilst drawn, with a beam whilst locked on | `w.player.toggleArm()`, the key and the slot alike: draws it, else unlocks it, else puts it away. Space fires, or raises it, see Targeting in `docs/engagements.md` |
| keys | how many doors they hold keys to; a padlock at one of them | locks or unlocks that door; right-click splits a key off |
| items | what else they carry, at most `inventoryConfig.maxCarried` | selects it, or lets it go |

After the slots come buttons for the player themself. A client gets only these. One that is on is white, else grey.

- **gait**, not on a client: walk or run (`w.player.toggleRun()`). A ↔ badge shows whilst strafing, toggled by a double tap of Shift. Whilst on, a notice "strafe" stays over the bar, its "x" turning it off. With the phaser raised it says "aim", its "x" lowering the phaser, and "strafe" with no "x": a double tap of Shift does nothing then. "aim blocked", in grey, is whilst something in the way draws the phaser in.
- **follow**: a press turns it on or off, as `f` does.
- **compass**, desktop only: the point `w` heads nearest, and a marker on its rim where `w` heads on screen.

Rules:

- Turning psi or the phaser ON needs it. So does jsh `phaser`, which throws without one. Turning either off never does.
- A phaser can be DEAD, and then cannot be raised: see `docs/shields.md`.
- The first three slots are grouped apart from the items. Only psi and the phaser have keys (`q`, `e`). The rest are clicked.
- `r` held turns the player to the pointer, phaser raised or not.
- A slot's tooltip is its name, and its key if it has one, e.g. `psi (Q)`.
- An item, and a carried phaser, show an "x" on hover which puts it down. An item shows it whilst selected too,
  which is how touch gets it. "drop" in either's right-click menu does the same. On touch a slot's menu opens on a
  long press.
- The bar re-renders when nudged (`w.hud?.update()`, from `w.e.setPsi`, `Phasers.sync` and every change to
  `carried` or to access), and on the player's own door and spawn events.

## What they carry

`w.e.carried[npcKey]` is `{ items, psi? }`. It is persisted per World, so it goes with them between maps.
`items` are the DEFS of the decor they took, so putting one down is `w.decor.create` of it.

- `giveItem(npcKey, "psi" | kind)`, `dropItem(npcKey, "psi" | itemKey | kind)`, `hasItem`.
- `revokeItem(npcKey, "psi" | kind)` takes it away outright, never put down. It backs the `psi` and `phaser`
  buttons in an npc's debug bubble, lit whilst they have it.
- `takeItem(npcKey, decorKey)` takes a runtime decor off the map: one in their own room only, never through a
  wall. With no room for it the bar says "inventory full" (`w.hud.say`), and a click does not walk them over.

### Where an item goes down

An item goes onto a table if one is in reach: an obstacle with `meta.surface` in their room, no further than
`inventoryConfig.reach.raised` (`seated` whilst sat, a little more). That is as far as it could be taken back from.

- A quad goes nowhere else.
- A point (the keycard) otherwise lies at their feet. Sat or lain they are off the floor, so it cannot be put down.

`w.e.getDropSpot` picks the spot NEAREST them:

- squared up to an edge long enough to take it, `surface.margin` in;
- ALL of it on the table top, which may be several abutting obstacles of one height;
- overlapping no other item, though they may touch.

Every edge in reach is tried, slid along `surface.step` at a time. With none, `dropItem` is `false`: the bar says
"cannot drop here" above itself, and `drop` throws.

### Reaching

Putting down takes a moment (`w.e.dropItem` starts it). They turn to the spot and reach out, the `drop` clip over
ONE arm. After `reachSecs` the item is there and their arm comes back. It stays in its slot until then, and they
put down one thing at a time.

Taking is the same in reverse (`w.e.takeItem`): they turn to the item and reach, the `pick_up` clip. After
`reachSecs` it is theirs and gone from the map. Both share `w.e.reachFor`.

Which arm:

- the left (`drop_left`, `pick_up_left`, `crouch_left`) if a gun is in their right hand;
- the right if psi has their left at their temple;
- else each in turn.

With both, the left hand leaves the temple and goes back, and psi stays on. The phaser itself is put down from the
right hand, straight from an aim.

On the FLOOR (below `reach.raisedFrom`) either is a squat instead: the whole-body `crouch` pose for `crouchSecs`,
then back to idle. Not whilst sat or lain, which use the arm clip.

#### Sat or lain

It is always the right arm, as no gun is in it there. The arm is AIMED: swung at the shoulder until the forearm
lines up on the spot (`anim.upper.aim`, as a phaser's, but with `maxRad` a half turn). So they reach back to a
shelf behind their head.

SAT, the clip is `sit_reach` instead, for either. Their hand rests under the table, so it is drawn back beside the
hip, up by the ribs and over the edge before it goes out. It comes home the same way.

- It plays from its start at full weight (`setUpper`'s `played`), and sets out from `sit`'s own arm.
- It takes `inventoryConfig.sitReach`: out by `outSecs`, when the item moves, and home by `homeSecs`.
- The aim eases in only once the hand is over the edge, and out before it comes back under.
- The clip turns their torso too: a lean back as the elbow comes back, forward into the reach. It turns ON `sit`'s
  own torso, which breathes on under it (`upperAddsTorso`).
- Their head is held level against those turns, and only glances at the spot (`sitReach.look`).
- What they put down goes where that hand comes down: `sitReach.at` ahead of them, so further onto the table than
  its edge. `getDropSpot` tries deeper in, and takes the spot nearest it.

## Items

An item is a runtime quad decor (a point, if flat) with `meta.item`, one of `inventoryConfig.kinds`.

- A quad is a cuboid with ONE textured face. `meta.h` is its height, and `y3d` its top.
- Its other faces are `inventoryConfig.sides`, or its kind's `sideOf` (the `box` is cardboard). Any other decor
  quad's are black. `meta.sides`, a colour, overrides either.
- A kind with no `inventoryConfig.height` is a point, the `keycard`, and `give` makes it one.

```sh
pick 1 | decor type:quad img:book meta:'{ item: "book", h: 0.05 }' y3d:0.05
pick 1 | decor type:point img:keycard scale:2 meta:'{ item: "keycard", door: "g0d29" }'
give rob items:"psi phaser"
drop rob items:phaser
```

### Keycards

A `keycard` may have `meta.door`, a gdKey. Not `meta.gdKey`: Debug's door toggle reads that off any pick.

- Carried, it is just an item and opens nothing. Its slot's right-click menu has "add to keychain", which grants
  that door (`w.e.chainKey`) and uses the card up.
- The keys slot's menu lists each held door. "split g0d8" takes it off the keys as a carried keycard again
  (`w.e.unchainKey`). That stamps `meta.map`, because a gdKey means nothing on another map, so the card only goes
  back on there.
- Held doors are saved with the npc, per map.

## The phaser

Psi and the phaser run together, an arm each (`anim.upperLeft`, `anim.upper`). Whoever carries a phaser and stands
has it in their right hand, raised or not (`w.phasers.holds`). Sat or lain it shows only whilst raised.

- The gun shows and hides at once, never fading, bar a drop. It stays in hand right through a teleport's fade-out,
  gone only whilst they are faded right out, and back as they fade in.
- Its roll about the forearm undoes whatever twist the forearm has NOT got (`restRoll`), read off the bone. So it
  never turns about its barrel as the arm comes up or down.
- The beam is cut the moment the aim is lowered, and waits for the arm to be all the way up, in `phaser_aim`.
- Stood before an obstacle the swing would meet (`swingHit`: one within reach whose span overlaps the band from the
  hand at rest, `restBelowGun` under the gun, to the gun), the arm goes up and comes down by way of `phaser_aim_avoid`,
  kept in. Raising, the `phaser_aim` stance waits for the arm to be up, else its own arm swings the gun forward through
  the obstacle. A raise from rest waits for the first cast, a frame or two, to know which way.
- Lowered, their target is kept for the next raise (`Phasers.toggle`), whilst the gun stays in hand.

### Crouched

Two crouches, behind cover such as a sofa: `crouch_half`, the head 1.32m up, and `crouch_cover`, a full squat at
1.05m. Either is their rest clip (`anim.setCrouch(level)`: `0` stood, `1` half, `2` full; read as `anim.crouchLevel`,
`anim.crouched`) until they stand or another clip is posed. On the move they stay crouched, in that crouch's gaits
(`docs/npc-strafe.md`).

- The player's `c`: a double tap, a full crouch, as a double tap of Shift toggles strafing. A tap crouches half from
  standing, stands from half, and comes up to half from full.
- jsh: `pose rob as:crouch_half`, `pose rob as:crouch_cover`, `pose rob as:breathe`.

- Raised, they stay crouched. `Phasers` skips its stance, and `phaser_aim` / `phaser_aim_avoid` play over the head and
  arms as on the move. The arms are corrected for the crouch's lean (`leanOfUpper`), so the gun is level, 0.67m up.
- Standing up whilst armed swaps to the `phaser_aim` stance: that is the pop-up.
- Crouched and not raised, the gun is held up out of the way: `phaser_aim_avoid` over the right arm (`tucked` in
  `wield`). Standing up lets it go. jsh `pose` may take the arm from it.

### Aiming and looking, sat or lain

The arm swings from the pose, which was drawn stood, to point where they aim (`armAimAt`). It eases onto each new
point (`glideArmAt`), and keeps its aim whilst coming down, so a pose drawn stood never swings it up. The head's
turn eases too (`headTurn`), so it glides.

**Sat** (`sitTurn` in `const.npc`):

- A look turns the head up to `maxRad` (90°) either way. It is kept once let go, until they stand.
- The gun aims from `aimFrom` to `aimTo`, 120° either way. Pointed somewhere it cannot reach, it goes to the limit
  nearer that point, always round the front (`turn.aim`, eased by `tickTurnAim`).
- Whilst an arm aims, the torso keeps still, so it never turns into the gun. Past `aimTorsoFrom` (45°) to their left
  it turns with the gun instead, so the right arm never crosses their chest. The head turns on top of it, but no more
  than 90° on the neck.

**Lain** (`lieAim` in `const.npc`, radians off their facing, which is towards their feet):

| pose | aims | head |
| --- | --- | --- |
| `lie`, on their back | -45° to 0°: never to their left, where the arm would lie across them | lifts, never tips back |
| `lie_left` | 20° to 120° | turns |
| `lie_right` | -120° to -20° | turns |

- They roll to the pose that reaches (`lieAimPoseFor`), at most once per `lieRoll.secs`.
- The head lifts or turns towards the point, up to `lieHeadMaxRad` (30°). On their back, a look beyond the head
  end looks straight up instead.
- `r` points the arm there (`w.phasers.pointAt`). With the phaser down, `r` looks the same way (`anim.lookLain`),
  and the look stays once let go, until they look elsewhere or get up.

### Drawn in

The arm is drawn in for a wall or closed door within reach, a shield, a target out of sight, or someone in the way.

- A wall, door or shield is looked for along two rays from their middle (`armEnds`): ahead, and to the gun's outer
  side at `reach`. Stood, the gun is right of their middle, so a jamb meets it before it meets the first ray.
- Both rays end `leadSecs` of their velocity on, so the arm is in before a strafe takes the gun into a wall.
- Stood or crouched, an obstacle blocks too if the gun's height is within its span, with `gunClear` to spare. The gun
  is `gunBelowHead` under their head's pivot (`anim.headY`): about 1.1m stood, 0.67m crouched. So most obstacles block
  only a crouch. Sat or lain, obstacles are ignored, being what they sit or lie at.
- A cast keeps every obstacle within reach, at any height (`arm.reach.obstacles`), and each tick tests them against the gun's
  height now. So crouching draws in at once, without waiting for the next cast. Crouched, it draws in over
  `quickDrawInSecs`.
- A ray passes obstacles, as it does doors (`w.e.raycast`'s `obstacles`: `top`, `bottom`, then `dist` to `leave`
  inside its outline, nearest first). The nav worker keeps their edges in its ray grid, beside the walls, bar those
  flat on the floor. One the ray starts inside, e.g. a seat, is inside from `0`. `bottom` is where its skirt ends
  (`obstacleBottom`), as `Obstacles` draws it.

| | someone in the way | drawn in is |
| --- | --- | --- |
| stood | found by `armMeetsNpc`, below | `phaser_aim_avoid`, over `drawInSecs` |
| sat | found by `armMeetsNpc`, below | `phaser_aim_avoid`, the arm's aim giving way as it swaps in |
| lain on their left side | found by `armMeetsNpc` | `phaser_aim_avoid` as sat: the arm is on top (`lieAim`'s `drawIn`) |
| lain otherwise | found by `armMeetsNpc` | stowed: still raised, the arm comes down over `stowSecs` with the gun in hand, until clear |

- `armMeetsNpc` looks through their room (`getNpcsInReach(key, 0)`), not the crowd's neighbours: those reach only
  `collisionQueryRange` (0.7m), short of the gun's tip.
- Near a door (its "nearby" sensor), it also looks at whoever else is near that door (`w.e.doorToNpcs`), either side.
  An arm can reach through a doorway into the next room.
- It polls every `sampleSecs` for the player and every `npcPollSecs` for anyone else, jittered.
- What can meet someone is their gun at full aim (`gunLine`). Stood, it is a fixed segment in their aim's frame
  (`phaserConfig.gun`, measured off `phaser_aim`): from the elbow to the muzzle, beside their right shoulder. Sat or
  lain, it is a line `reach` long from their right shoulder bone, the way the arm points (`armBearingOf`).
- A body is in the way within `bodyRadius + armWidth` of it, or `agentRadius + armWidth` for one sat or lain.
- An arm is in the way when the two guns come within `2 * armWidth` (`segsApart`), but only an arm up now, not
  drawn in. So of two that would meet, whoever raised first keeps it and only the other draws in.
- The player gives way to no npc's arm, only to bodies.
- Lain, only a current raycast counts, as a roll leaves the last one stale.

### Shots, hits and choosing a part

How a shot ends, what a hit does, and targeting are in `docs/engagements.md`.

## The `inventory` command

`inventory` decides what a short press does. It is in the default profile, and `inventory off` stops it.

- **On an item**, the player walks up to it, stopping `standOff` short, or as near as the navmesh allows, e.g.
  beside its table. They take it if then within `inventoryConfig.reach`: tight for one on the floor, looser for one
  whose top (`y3d`) is higher. Sat or lain in reach, they take it from there. A newer press abandons it.
- **On another npc**, with psi raised, it focuses psi on them, offering its actions (see `docs/psi.md`).
- **On the player's own right arm**, a raised phaser is lowered, its target forgotten. A press elsewhere on them does
  nothing.
- **On the player's own LEFT arm**, psi is lowered, phaser drawn or not.

`predicates`' pick ring stands down meanwhile. `inventory` is a keyed listener (`w.e.addKeyedListener`), as
`predicates` is, so there is no process to kill.
