# Inventory

What an npc has, and the bar that shows the player's. The ONLY doc for it.

| file | what |
| --- | --- |
| `ui/world/src/components/WorldHud.tsx` | the bar, `w.hud` |
| `ui/world/src/components/use-world-events.ts` | what is carried, `w.e.carried`, and held keys |
| `ui/world/src/service/storage.ts` | `carried` (per World), `PersistedNpc.access` (per map) |
| `ui/world/src/const.env.ts` | `inventoryConfig`: kinds, heights, reach, the most carried |
| `cli/src/jsh/world/core.ts` | `give`, `drop`, `kamma` |
| `media/src/decor/{phaser,book,box,keycard}.svg` | an item's one textured face, as decor |
| `media/src/icon/*-icon.svg` | its drawing in the bar, imported as `itemIconUrl` from `@npc-cli/media/icon` |

## The bar

Bottom centre of a World; a slot is pressed. None on a net client, where neither psi
nor phasers are mirrored.

| slot | shows | a press |
| --- | --- | --- |
| psi, `q` | faded unless granted; its neurons fire whilst on | `w.player.togglePsi()` |
| phaser, `e` | faded unless carried; its emitter lit whilst drawn, with a beam whilst locked on | `w.player.toggleArm()`: draws it, else unlocks it, else puts it away |
| keys | how many doors they hold keys to; a padlock at one of them | locks or unlocks that door; right-click splits a key off |
| items | what else they carry, at most `inventoryConfig.maxCarried` | selects it, or lets it go |

Turning psi or the phaser ON needs it; turning it off never does, so a jsh `arm rob` can be holstered.
The first three are grouped apart from the items. Only psi and the phaser have keys (`q`, `e`); the rest
are clicked. A slot's tooltip is its name, and its key if it has one e.g. `psi (Q)`. On touch a two-finger tap on the World does the same: its left half psi, its right half the phaser.
An item, and a carried phaser, show an "x" which puts it down on hover — an item whilst selected
too, which is how touch gets it — as does "drop" in the right-click menu of either. On touch
a slot's menu opens on a long press.

The bar re-renders when nudged (`w.hud?.update()`, from `Psi.choose`, `Phasers.sync` and every change
to `carried` or to access) and on the player's own door and spawn events.

## Having

`w.e.carried[npcKey]` is `{ items, psi? }`, persisted per World so it goes with them between maps.
`items` are the DEFS of the decor they took, so putting one down is `w.decor.create` of it.

An item goes down onto a table if one is in reach: an obstacle with `meta.surface` in their room, the
spot no further than `inventoryConfig.reach.raised` (`seated` whilst sat, a little more) — as far as it could be taken back from. A quad goes nowhere else. A point (the keycard)
otherwise lies at their feet — unless they are sat or lain, off the floor, when it cannot be put down.
`w.e.getDropSpot`
picks the spot NEAREST them: squared up to an edge long enough to take it, `surface.margin` in, ALL
of it on the table top — which may be several abutting obstacles of one height — and overlapping no
other item (they may touch). Every edge in reach is tried, slid along a `surface.step` at a time. With none `dropItem` is `false`: the bar says "cannot drop here" above itself, `drop` throws.

Putting down takes a moment (`w.e.dropItem` starts it): they turn to the spot and reach out — the
`drop` clip over ONE arm — and after `reachSecs` the item is there and their arm comes back. It stays
in its slot until then, and they put down one thing at a time.

Which arm: the left (`drop_left`, `pick_up_left`, `crouch_left`) if a gun is in their right hand, the
right if psi has their left at their temple, else each in turn. With both, the left hand leaves the
temple and goes back; psi stays on. The phaser itself is put down from the right hand, straight from an aim.

Taking is the same in reverse (`w.e.takeItem`): they turn to the item, reach — the
`pick_up` clip — and after `reachSecs` it is theirs and gone from the map. Both share `w.e.reachFor`.

Sat or lain it is always the right arm — no gun is in it there — and it is AIMED: swung at the shoulder
until the forearm lines up on the spot (`anim.upper.aim`, as a phaser's, but with `maxRad` a half turn),
so they reach back to a shelf behind their head.

On the FLOOR (below `reach.raisedFrom`) either is a squat instead: the whole-body `crouch` pose for
`crouchSecs`, then back to idle. Not whilst sat or lain: then it is the arm clip as above.

Psi and the phaser run together, an arm each (`anim.upperLeft`, `anim.upper`). Whoever carries a
phaser and stands has it in their right hand, raised or not — `w.phasers.holds`; sat or lain it is gone.

- The gun shows and hides at once, never fading, bar a drop: it is in hand right through a teleport's
  fade-out, gone only whilst they are faded right out, and back as they fade in.
- Its roll about the forearm undoes whatever twist the forearm has NOT got (`restRoll`), read off the
  bone, so it never turns about its barrel as the arm comes up or down.
- The beam is cut the moment the aim is lowered, and waits for the arm to be all the way up.
- Lowered, their target is kept for the next raise (`Phasers.toggle`) — whilst the gun stays in hand.
- Psi's contours fan out TOWARDS its target, the player no longer turning to them — ahead, with none
  — swung round as it changes (`psiConfig.swing`). Over anyone lain down the relief holds its peak
  for `lieFlat` metres before it falls, so it does not drop into them.

- `giveItem(npcKey, "psi" | kind)`, `dropItem(npcKey, "psi" | itemKey | kind)`, `hasItem`.
- `takeItem(npcKey, decorKey)` takes a runtime decor off the map — one in their own room only, never through a wall.

## Items

An item is a runtime quad (or, if flat, point) decor with `meta.item`, one of `inventoryConfig.kinds`. A quad is a
cuboid with ONE textured face: `meta.h` is its height, and `y3d` its top. Its other faces are
`inventoryConfig.sides` (or its kind's `sideOf`: the `box` is cardboard), where any other decor quad's are black — `meta.sides`, a colour, says otherwise for either. A kind with no
`inventoryConfig.height` is a point — the `keycard` — and `give` makes it one.

```sh
pick 1 | decor type:quad img:book meta:'{ item: "book", h: 0.05 }' y3d:0.05
pick 1 | decor type:point img:keycard scale:2 meta:'{ item: "keycard", door: "g0d29" }'
give rob items:"psi phaser"
drop rob items:phaser
```

A `keycard` may have `meta.door`, a gdKey. Carried, it is just an item and opens nothing: its slot's
right-click menu has "add to keychain", which grants that door (`w.e.chainKey`) and uses the card up.
The keys slot's menu lists each held door, "split g0d8" taking it off the keys as a carried keycard
again (`w.e.unchainKey`, which stamps `meta.map` — a gdKey means nothing on another map, so that
card only goes back on there). Held doors are saved with the npc, per map. Not `meta.gdKey` —
Debug's door toggle reads that off any pick.

## kamma

`kamma` (in the default profile, `kamma off` to stop) decides what a short press does:

- on an item, the player walks up to it — stopping `standOff` short, or as near as the navmesh allows
  e.g. beside its table — and takes it if then within `inventoryConfig.reach`: tight for one on the
  floor, looser for one whose top (`y3d`) is higher. Sat or lain in reach they take it from there. A
  newer press abandons it;
- on an npc whilst the phaser is drawn, the beam locks onto the part pressed. A press on the
  player's own right arm lowers it instead, its target kept for when it is next raised, and one
  elsewhere on them does nothing. With the phaser
  lowered and psi on, another npc pressed becomes psi's target. A press on the player's own LEFT
  arm lowers psi, phaser drawn or not, keeping its target for when it is next raised. `predicates`' pick ring stands down meanwhile.

It is a keyed listener (`w.e.addKeyedListener`), as `predicates` is, so there is no process to kill.
