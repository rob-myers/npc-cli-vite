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
A selected item, and a drawn phaser, show an "x" which puts it down.

The bar re-renders when nudged (`w.hud?.update()`, from `Psi.choose`, `Phasers.sync` and every change
to `carried` or to access) and on the player's own door and spawn events.

## Having

`w.e.carried[npcKey]` is `{ items, psi? }`, persisted per World so it goes with them between maps.
`items` are the DEFS of the decor they took, so putting one down is `w.decor.create` of it.

A point (the keycard) goes down at their feet. A quad goes down ONLY onto a table: an obstacle with
`meta.surface` in their room, an edge of it within `inventoryConfig.reach.raised`. `w.e.getDropSpot`
picks the spot — in from the nearest edge by `surface.inset`, tried along it until one is clear of
other items by `surface.gap` — and with none `dropItem` is `false`: the bar says "cannot drop here" above itself, `drop` throws.

- `giveItem(npcKey, "psi" | kind)`, `dropItem(npcKey, "psi" | itemKey | kind)`, `hasItem`.
- `takeItem(npcKey, decorKey)` takes a runtime decor off the map.

## Items

An item is a runtime quad (or, if flat, point) decor with `meta.item`, one of `inventoryConfig.kinds`. A quad is a
cuboid with ONE textured face: `meta.h` is its height, and `y3d` its top. A kind with no
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

- on an item, the player walks to it and takes it once within reach; a newer press abandons it.
  `inventoryConfig.reach` is tight for one on the floor, looser for one whose top (`y3d`) is higher e.g. on a desk
  — which they cannot walk onto, so they must already be beside it;
- on an npc whilst the phaser is drawn, the beam locks onto the part pressed. A press on the
  player's own right arm unlocks it instead, and one elsewhere on them does nothing; whilst psi is on, they
  become its target. `predicates`' pick ring stands down meanwhile.

It is a keyed listener (`w.e.addKeyedListener`), as `predicates` is, so there is no process to kill.
