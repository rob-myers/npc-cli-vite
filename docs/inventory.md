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

Bottom centre of a World; a slot is pressed, or its digit is. None on a net client, where neither psi
nor phasers are mirrored.

| slot | shows | a press |
| --- | --- | --- |
| `1` psi | faded unless granted; its neurons fire whilst on | `w.player.togglePsi()` |
| `2` phaser | faded unless carried; its emitter lit whilst drawn, with a beam whilst locked on | `w.player.toggleArm()`: draws it, else unlocks it, else puts it away |
| `3` keys | how many doors they hold keys to; lit at one of them | locks or unlocks that door; right-click splits a key off |
| `4`-`9` | what else they carry, at most `inventoryConfig.maxCarried` | selects it, or lets it go |

Turning psi or the phaser ON needs it; turning it off never does, so a jsh `arm rob` can be holstered.
A selected item, and a drawn phaser, show an "x" which puts it down — as does "drop" in the
right-click menu of either, with no need to select or draw it first.

The bar re-renders when nudged (`w.hud?.update()`, from `Psi.choose`, `Phasers.sync` and every change
to `carried` or to access) and on the player's own door and spawn events.

## Having

`w.e.carried[npcKey]` is `{ items, psi? }`, persisted per World so it goes with them between maps.
`items` are the DEFS of the decor they took, so putting one down is `w.decor.create` of it.

An item goes down onto a table if one is in reach: an obstacle with `meta.surface` in their room, the
spot no further than `inventoryConfig.reach.raised` — as far as it could be taken back from. A quad goes nowhere else. A point (the keycard)
otherwise lies at their feet — unless they are sat or lain, off the floor, when it cannot be put down.
`w.e.getDropSpot`
picks the spot NEAREST them: squared up to an edge long enough to take it, `surface.margin` in, ALL
of it on the table top — which may be several abutting obstacles of one height — and overlapping no
other item (they may touch). Every edge in reach is tried, slid along a `surface.step` at a time. With none `dropItem` is `false`: the bar says "cannot drop here" above itself, `drop` throws.

Putting down takes a moment (`w.e.dropItem` starts it): a drawn phaser is put away, they turn to the spot, and
reach out — the `drop` clip over their upper body — and after `reachSecs` the item is there and their
arm comes back. It stays in its slot until then, and they put down one thing at a time.

Taking is the same in reverse (`w.e.takeItem`): they turn to the item, reach — the
`pick_up` clip — and after `reachSecs` it is theirs and gone from the map. Both share `w.e.reachFor`.

On the FLOOR (below `reach.raisedFrom`) either is a squat instead: the whole-body `crouch` pose for
`crouchSecs`, then back to idle. Not whilst sat or lain, nor with their arms busy (phaser drawn, psi):
then it is the upper-body clip as above.

- `giveItem(npcKey, "psi" | kind)`, `dropItem(npcKey, "psi" | itemKey | kind)`, `hasItem`.
- `takeItem(npcKey, decorKey)` takes a runtime decor off the map.

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
  player's own right arm unlocks it instead, and one elsewhere on them does nothing; whilst psi is on, they
  become its target. `predicates`' pick ring stands down meanwhile.

It is a keyed listener (`w.e.addKeyedListener`), as `predicates` is, so there is no process to kill.
