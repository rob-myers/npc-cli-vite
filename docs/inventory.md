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
| phaser, `e` | faded unless carried; its emitter lit whilst drawn, with a beam whilst locked on | `w.player.toggleArm()`, the key and the slot alike: draws it, else unlocks it, else puts it away. A shot needs no raising first: see [Npc focus](#npc-focus) |
| keys | how many doors they hold keys to; a padlock at one of them | locks or unlocks that door; right-click splits a key off |
| items | what else they carry, at most `inventoryConfig.maxCarried` | selects it, or lets it go |

After the slots come buttons for the player themself. A client gets only these. One that is on is white, else grey.

- **walk/run**, not on a client: `w.player.toggleRun()`, their `anim.hurry`.
- **look/follow**: a press looks, and a long press toggles the follow, as `f` does.
- **compass dial** (`c`, `w.view.setCompassDial`): a letter naming the compass point up the screen. It is
  persisted per World and on by default.

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
- The beam is cut the moment the aim is lowered, and waits for the arm to be all the way up.
- Lowered, their target is kept for the next raise (`Phasers.toggle`), whilst the gun stays in hand.

### Aiming sat or lain

The arm swings from the pose, which was drawn stood, to point where they aim (`armAimAt`, eased by `glideArmAt`).

- **Sat**, the head turns up to `sitTurn.maxRad` (90°) either way. The gun aims from `aimFrom` to `aimTo`, further
  on its hand's side. The torso keeps still whilst an arm aims, and the turn is kept whilst the phaser is raised.
- **Lain**, each pose aims within its arc (`lieAim`), and they roll to the pose that reaches (`lieAimPoseFor`). The
  head lifts towards it. `r` points the arm (`w.phasers.pointAt`) instead of rolling them.

### Drawn in

The arm is drawn in for a wall or closed door within reach, a shield, a target out of sight, or someone in the way.

| | someone in the way | drawn in is |
| --- | --- | --- |
| stood | a crowd neighbour ahead (`npcAhead`) | `phaser_aim_avoid` |
| sat | found by `armMeetsNpc`, below | `phaser_aim_avoid`, the arm's aim giving way as it swaps in |
| lain | found by `armMeetsNpc`, below | stowed: still raised, but the arm comes down and the gun hides, until clear |

- Sat or lain they are off the crowd, so `armMeetsNpc` looks through their room instead (`getNpcsInReach(key, 0)`).
- It polls every `sampleSecs` for the player and every `npcPollSecs` for anyone else, jittered.
- Someone is in the way within `agentRadius + armWidth` of a line `reach` long, from their right shoulder
  (`shoulderRight`) the way they aim.
- Lain, only a current raycast counts, as a roll leaves the last one stale.

### What a hit does

As a beam locks on, and no shield stops it, `w.npc.hit` plays a clip on its target. The clip depends on the part
locked on to, and on whether they stand, sit or lie (`hitConfig` in `const.npc`). It emits `npc-hit`.

| part | stood | sat / lain |
| --- | --- | --- |
| head | `pain_head` | `{sit,lie}_pain_head` |
| chest, stomach, hips | `pain_high` | `{sit,lie}_pain_high` |
| an arm or leg | `pain_{arm,leg}_{left,right}` | `{sit,lie}_pain_low` |

- Every hit pacifies. Its pain clip plays once, then `pacified` (or `{sit,lie}_pacified`) loops.
- A head shot's clip ends slumped, so goes straight on. Any other ends stood, so fades into it over `pacifyFadeSecs`.
- Pacified lasts until released: `pose npc-0 as:breathe`, or `as:sit` / `as:lie`.
- Whilst in pain or pacified (`anim.hurt`) they can do nothing. A move under way is stopped (it rejects with `hit`),
  their phaser is lowered, and `move`, `look` and arming are refused.
- Pain on someone pacified leaves them pacified after. A head shot on them has no effect, nor does the label, or no part.
- One lock hits once. Hits are not mirrored over the network.

### Npc focus

Carrying a phaser, a click on someone focuses on them (`NpcFocus`, `w.npcFocus`), as does jsh `focus target-0`:

1. `aimAt` turns the player to them, raising the phaser on the way (at most `turnMaxMs`).
2. It waits for the phaser to come up clear as they now stand, by a cast made there (`w.phasers.isClear`, at most
   `raiseMaxMs`).
3. Drawn in there (`phaser_aim_avoid`), or out of sight (a raycast is blocked), it ends with the phaser left raised.
4. Otherwise the World pauses and the view zooms in. A mark is pinned over their head, body, arms and legs, placed
   from their bones each frame.
5. A mark pressed, or its digit `1`–`6`, shoots that part once, at one bone (`npcFocusConfig.bones`). Escape, or
   the note at the top, shoots nothing.
6. The World resumes, unless it was paused before. The view stays where it is.

Whilst it runs:

- `cancel` ends it as Escape does, at any stage. `focus` runs until it is over, and a kill (ctrl-c) cancels it.
- Only the marks take the pointer, so the camera still moves. The paused indicator is hidden (`showsPaused`).
- A follow runs on whilst they aim, is set aside for the zoom, and resumes after.
- The player's moves are refused whilst it aims and in the pause it opens in (`w.e.move` throws `focused`), held
  keys included, as a move would undo the turn. Once resumed they move again.

Resumed with the marks up (Enter, or play):

- Escape only pauses the World, as ever. It ends the focus only in the pause it opened in (`resumed`).
- The marks fade out whilst the player faces more than `maxOffAimRad` (15°) away (`offAim`), and back in as they
  face them again.
- Lowering the phaser, e.g. by `e`, ends it as Escape does (`isLost`).

After it, the phaser is lowered (`arm`'s `once`, at most `onceSecs`), unless it was raised before the click, e.g. by `e`.

## The `inventory` command

`inventory` decides what a short press does. It is in the default profile, and `inventory off` stops it.

- **On an item**, the player walks up to it, stopping `standOff` short, or as near as the navmesh allows, e.g.
  beside its table. They take it if then within `inventoryConfig.reach`: tight for one on the floor, looser for one
  whose top (`y3d`) is higher. Sat or lain in reach, they take it from there. A newer press abandons it.
- **On another npc**, with psi on, their thought is read (`docs/psi.md`). Else, carrying a phaser, it focuses on
  them (see [Npc focus](#npc-focus)).
- **On the player's own right arm**, a raised phaser is lowered, its target forgotten. A press elsewhere on them does
  nothing.
- **On the player's own LEFT arm**, psi is lowered, phaser drawn or not.

`predicates`' pick ring stands down meanwhile. `inventory` is a keyed listener (`w.e.addKeyedListener`), as
`predicates` is, so there is no process to kill.
