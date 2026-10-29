# Doors

`components/Doors.tsx` draws the doors and holds their state: `w.door`, and `w.d` by gdKey (`g0d38`).
`use-world-events` decides who may change one: `w.e.toggleDoor` and `toggleLock`.
Their settings are `doorConfig` in `const.env`. Their sizes are with the walls': see `docs/walls.md`.

## A door's state

`Geomorph.DoorState`, built per map by `buildByKey`:

| Field | Meaning |
| --- | --- |
| `open` | Changes only once the door has finished opening or shutting. `w.door.isHeadedOpen(door)` is where it will rest. |
| `locked` | Only an npc with access opens it. Any npc may shut it. |
| `sealed` | Never opens, and is always locked. |
| `auto` | Opens when an npc touches its "nearby sensor", unless locked. Every unsealed hull door is auto. |
| `proximity` | Stays open whilst anyone is near. Defaults to `auto`. |
| `held` | Kept open or shut as it is. See [Holding](#holding). |
| `hull` | Joins two geomorphs. Its twin on the other side opens and shuts with it. |

We could have non-`auto` doors which are `proximity` i.e. once manually opened they stay open if an npc is close.

Likewise we could have `auto` doors which are not `proximity` i.e. automatically open but close even if an npc remains standing nearby.

## Opening and shutting

- **An npc coming by** opens it (`onEnterCollider`, and `started-moving` for one already near). An `auto` door opens
  for anyone. A manual one opens only for an npc whose path crosses it (`npcIntention`).
- **An opened door tries to shut** after `doorConfig.closeMs` (`tryCloseDoor`). It waits whilst anyone is in the
  doorway, or near it and moving, or near a `proximity` door at all (`canAutoCloseDoor`).
- **A press** on a door, its switch or its door spot toggles it, whilst **toggle doors** is on in the debug menu (`w.e.onPickDoor`).
- **Access** (`w.e.toggleDoor`): no npc, i.e. a press or jsh, always has it. Shutting needs none.
  Opening a locked door needs `w.e.npcCanAccess`: keys (see `docs/inventory.md`), or the door already open.

## Locking

- `w.e.toggleLock`, jsh `lock` and `unlock`.
- The player's keys slot locks or unlocks the nearest door they hold keys to.
- A long press on the door itself locks or unlocks it, keyless.
- An unlocked door that is open starts its usual close.

## Holding

A held door, locked or not, stays as it is:
- Open, it never shuts of itself.
- Shut, no npc coming by opens it, even an `auto` one. One walking into it still does, if they may. It then stays open.

Otherwise only a press, jsh without `as:`, or an npc asked to hold or let go changes it.

- `w.door.setHeld(door, held)` holds it as it is, or lets it go. Let go whilst open, it starts its usual close (`try-close-door`).
- `w.e.toggleDoor(gdKey, { open, close, held, npcKey })` opens or shuts it, then holds it or lets it go.
- A long press on a switch or a door spot holds the door, or lets it go.
- An npc asked to open or shut a held door is refused, unless walking into it, or also asked to hold it or let it go.

## Switches

A door's switches are tinted by its state (`doorConfig.tint`, `syncLockTint`):

| | Unlocked | Locked |
| --- | --- | --- |
| Not held | green `unlocked` | red `locked` |
| Held | blue `held` | purple `heldLocked` |

## Menu

Whilst the debug **context menu** is on, a right-click on a switch (a long press on touch) opens its menu
(`PickMenu`). It toggles **open**, **held**, **locked**, **auto** and **proximity**, and stays open
whilst used. `w.door.setFlag` sets the last two, and emits `door-toggled`, as
`setHeld` does. A sealed door's rows are disabled.

## Saved

- Per World and map (`getWorldMapStore`): `doorLocks` and `doorHolds`, both lists of gdKeys. `doorLocks` is
  exhaustive, so a door the map locks (`meta.locked`) but we unlocked stays unlocked.
- `doorFlags` holds, by gdKey, each `auto` and `proximity` that differs from the map's.
- `persistLocks` saves all three on each change. `buildByKey` restores them.
- A reset of the map's state (`resetLocks`) locks just what the map asks for, holds none, and takes its `auto` and `proximity`.
- Restoring from another World takes its locks and holds (`applyLocks`).
- A client of a server World takes its locks and open doors, but not its holds: its switches show no hold.

## jsh

```sh
open g0d38          # a press: always allowed, bar a sealed door
close g0d38 g0d39
open --hold g0d38   # opened, and held open
close --hold g0d38  # shut, and held shut
open --release g0d38
open g0d38 as:rob   # as rob would: refused if locked and rob has no keys
close g0d38 as:rob  # anyone may shut it, unless it is held open
lock g0d38; unlock g0d38
```

A refusal is an error naming each door and why, e.g. `g0d38: locked: rob has no access` or `g0d38: held open`.
The rest of the doors given are still tried.
