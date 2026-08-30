# Fade modes and the room sweep

Notes on the uncommitted work in `packages/ui/world`, written up so it can be reverted and
re-applied a piece at a time. Roughly 645 lines added across 15 files, most of it in
`service/fade-rooms.ts`.

The work splits into **six independent pieces**. Later ones assume earlier ones, in this order:

1. Three modes replacing the fade boolean
2. The second phase (a per-slot value that outlives the colour fade)
3. That phase driving a **sweep** from the door a room is seen through
4. Planar vs radial sweep
5. Ordering rooms by distance from the player
6. NPC behaviour around all of it

---

## 1. Three modes

`FadeRoomsMode = "focus" | "map" | "gm"`, cycled by the fade button and bound to keys **1/2/3**:

| key | mode | what it does |
|---|---|---|
| 1 | `focus` | rooms out of view go black, then are swept away entirely |
| 2 | `map` | rooms out of view go black and stay (what "fade" used to be) |
| 3 | `gm` | everything shown |

- **`service/fade-rooms.ts`** — the type plus `fadeRoomsModeByKey`, `nextFadeRoomsMode(mode)` (cycle
  `focus → map → gm → focus`), and `parseFadeRoomsMode(unknown)` which defaults to `"gm"`.
  `FadeRooms.enabled: boolean` became `FadeRooms.mode`.
- **`service/storage.ts`** — `fadeRooms: boolean` became `fadeRoomsMode: FadeRoomsMode`, default
  `"gm"`. The store version is deliberately **not** bumped — that would discard every world setting
  — so the old boolean is simply ignored and everyone starts on `gm` once.
- **`WorldView.tsx`** — `state.fadeRooms` became `state.fadeRoomsMode`; `setFadeRoomsEnabled` became
  `setFadeRoomsMode(next = nextFadeRoomsMode(current))`, keeping both of its side effects (persist,
  and force the post pass on for anything but `gm`). `setFadeRoomsActive(active: boolean)` became
  `setFadeRoomsActive(mode)` — it is the intro's non-persisting override. Keys 1/2/3 go in the
  existing `onKeyDown` chain, ignoring `e.repeat`; `e`/`E` still cycles.
- **`use-world-events.ts`** — the intro's two calls: `setFadeRoomsActive("gm")` and
  `setFadeRoomsActive(w.view.fadeRoomsMode)`.
- **`WorldMenu.tsx`** — three icons (`CircleNotchIcon` / `CircleDashedIcon` / `CircleIcon`) and a
  `title` naming the mode.

Mode is plain CPU state read by `sync`, exactly as `enabled` was. **A mode switch does not need a
new `uid`** — no material rebuild.

## 2. The second phase

`fade-rooms` keeps its existing `morphs` array (the colour fade, `1` shown to `0` black) and gains a
second of the same shape, `marks`, where `0` is "all there" and `1` is "gone". Only `focus` mode
ever drives it above 0.

**The two phases run in turn**, which falls out of giving a morph a start time in the future — both
`morphAt` and `morphNode` clamp how far along a morph is, so one that has not set off reads as
`from`. So `service/morph.ts` grew:

```ts
export function retarget(m, wanted, secs, now, startAt = now) { ... m.at = startAt }
export function remaining(m, secs, now) { return Math.max(m.at + secs - now, 0) }
```

and `sync` chains each phase off whatever the other has left:

- **going out** — colour drains, then the sweep takes what is left of it;
- **coming in** — the two run **together**, so the room colours up as it arrives.

`keepFramesComing` had to cover both phases plus any stagger (piece 5); it takes the longest wait
this sync scheduled.

## 3. The sweep

Rather than a plane sinking through a room, the second phase drives a **front that retreats towards
the door or window the player sees the room through** — so a room empties from its far end back to
the opening, and fills the other way about.

**Finding the way in.** `roomsInView` is now a breadth-first walk of `gmRoomGraph` rather than
`getReachableUpTo`, which gives the rooms but not the connector each was reached *through*.
Breadth-first means the recorded `via` is the shortest way in, which is the one the player is
looking through. It returns `{ room, via, hops }`, with `via: null` only for the player's own room.
Shut doors are still reached and not passed. **Windows are only passed from the player's own room**
— the walk collects `ownConnectors = getSuccs(root)` up front and refuses to expand any window node
outside it, so glass is seen through from where the player stands but not from across another room.

**The packing.** `setSweep` writes one `vec4` per slot, giving a depth that is **0 at the way in and
1 at the far end of the room**, so a front of 1 shows all of it and 0 shows none. Two forms, told
apart by `w`:

- `(a, b, c, 0)` — a plane along the way in's normal, `a·x + b·z + c` over world `xz`
- `(x, z, 1/radius, 1)` — a circle growing out of the way in (piece 4)

Folding the room's reach into the vector is what puts it in those units: every room sweeps in the
same time whatever its size, and the shader has one dot or one length to do. It also gives two free
special cases:

- **the player's own room** → `(0, 0, 0, 0)`, depth always 0, never swept — it arrives whole;
- **anything unreached** (hull walls, rooms never seen) → `(0, 0, 1, 0)`, depth always 1, gone as
  soon as its mark moves.

**Three things that bit, all worth keeping:**

- **Sweeps must not be cleared each sync.** A room leaving view is by definition not in view, so
  refilling the array each time destroyed exactly the data the fade-out needed and the room vanished
  whole. Only rooms *in view* get a fresh sweep; the rest keep what they had, which is the way they
  were last entered by.
- **The player's own room must drop its marker when it stops being theirs.** Depth 0 is never beyond
  any front, so with the marker left on it could never be hidden at all. `neverSwept()` spots it and
  `sync` replaces it with the unreached default the first time the room is not shown. (This is the
  one case that still ends abruptly rather than sweeping — it has no way in to retreat along.
  Usually behind the player and off-screen.)
- **The player's own room keeps a sweep it is still arriving on.** The marker is only stamped once
  the room's mark has settled; walking into a room mid-sweep, it would otherwise snap the rest of it
  into place.

**Measuring the reach.** `setSweep` normalises over the room's whole extent along the normal —
`[min, max]` of the outline plus a 0.3m margin — **not** `[0, max]`. A room is rarely all on one
side of its own doorway: the door sits on the line, a broad wall straddles it, wall decor hangs on
it, and an L-shaped room can have an arm behind it. Measuring from the furthest point *back* is what
stops those being left standing.

**Broad walls** span two rooms, so half of one stands in the other. They take the sweep of whichever
adjacent room is shown, but **measured over both rooms' outlines** (`setSweep`'s `alsoSpanning`) —
otherwise the far half sits behind the near room's `lo` at a negative depth no front ever reaches,
and it hangs there alone. An earlier fix that discarded everything once `mark >= 1` was rejected:
it popped rather than swept.

**The shader side** — `applySweep(node, slot, where?)` and `applySweepPair(node, slots)`, replacing
`applyHideMark`/`hideMarkPair`. The pair form discards only when **both** rooms have swept past,
so a wall or door stands while either side still shows it. Wrapped around what each material already
builds, in the `useMemo` that already depends on `fadeRoomsFx.uid`:

| file | node |
|---|---|
| `Ceiling.tsx` | `texNode`, on the texture-decoded slot |
| `Walls.tsx` | wall and trim `colorNode` (pair) |
| `Doors.tsx` | front, back and edge `colorNode` (pair) |
| `Obstacles.tsx` | tops and skirts `colorNode` |
| `Decor.tsx` | both textured `colorNode`s and both black `opacityNode`s |
| `Floor.tsx` | `texNode`, with `where = objectPick.equal(0)` |

The hull needs nothing: `Walls.setSegSlots` already gives hull segments `neverShownSlot`.

**The floor**, two things:

- It is swept like everything else, but **not while picking** — that is what `applySweep`'s `where`
  is for. The floor is the fallback `dropPickWhenHidden` lets clicks through *to*, so sweeping it in
  the pick pass left nothing to catch them.
- In `focus` mode it is **not darkened at all**: `focusNode` (a uniform, `1` in `focus`) is `max`'d
  into its tint, so the floor keeps its colour and going is what takes it away. In `map` mode it
  still darkens to `fadedRoomFloorTint`. This is also what makes it read as arriving early on the
  way in, rather than turning up nearly black and brightening at the end.

An earlier version gave the floor a **third** phase of its own (a `floors` morph array, `FLOOR_SECS`,
`getFloorHide`) so it went last of all. That was removed — it now just falls out of the sweep.

## 4. Planar vs radial

`isBoxy(poly)` — shoelace area of the outline against `poly.rect.area`, measured in the geomorph's
own space where rooms sit square on. At or above `boxyFraction` (0.85) the room gets the **plane**;
below it, the **circle** centred on the connector, whose radius reaches the furthest corner across
whatever the sweep spans. An L-shaped room swept by a plane has a whole arm arriving side-on,
whereas light through a door reaches round a corner the way a circle does.

`sweptAway` computes both and selects on `sweep.w` — each is a couple of instructions, so it picks
between values rather than branching around them.

## 5. Ordering by distance

`RoomInView.hops` — 0 for the player's own room, 1 for one seen through a connector, and so on —
persisted per slot in `hopsBySlot` for the same reason the sweeps are (a room on its way out is no
longer in view to be asked).

- coming **in**: a slot waits `hops · ROOM_STAGGER_SECS`, so the world opens outwards;
- going **out**: it waits `(farthest − hops) · ROOM_STAGGER_SECS`, where `farthest` is the largest
  hop count among the rooms currently leaving — so the world folds back towards the player instead
  of stranding a near room after the one joining it has gone.

Broad walls inherit the `hops` of the room they were swept from.

## 6. NPCs

Three separate rules, which took several passes to separate properly:

- **Going out** they go with the room, over their own share of its fade (`npcFadeShare`): the colour
  drains first, then a **sphere closes onto their middle** (`applySphereFade`, local space, so on a
  skinned mesh it follows the pose). Nothing touches their alpha — fragments are kept or discarded —
  so there is never a part-transparent depth-writing npc sorting against itself. That was the source
  of the flicker every alpha-based attempt hit. `applySphereFade` takes a `where` (passed `isMain`)
  because a discard takes the fragment whichever branch of a `select` it came from, and every label
  fragment shares one `positionLocal`.
- **Standing in a room that is arriving** they wait for it: `arrived` ramps from the room's mark over
  its last `npcArriveTail`, so nobody is visible in a room that has not landed.
- **Walking into a room that is arriving** they do **not** dim. `syncNpcRoomSlots` keeps the room
  they came from while `fx.isArriving(next) && fx.hasArrived(current)`; every other case assigns at
  once, so walking into a hidden room still fades them out. It runs on the **tick** as well as on
  the room-change events, so they take the new slot the moment it lands. Called just before
  `w.shadows.onTick()`, which reads the slot it settles.

The label keeps its own timing (`applyFadeAlpha` on an eased `roomFade`) and is excluded from the
sphere.

New CPU queries on the service for this: `isArriving(slot)`, `hasArrived(slot)`, and `isHiding(slot)`
(a node, `1` while a slot is on its way out).

---

## Tuning constants

| where | name | value |
|---|---|---|
| `fade-rooms.ts` | `ROOM_FADE_SECS` | 0.7 — shared with `map` mode and the npc fades |
| | `MARK_SECS` | 1.8 — how long the sweep takes to cross a room |
| | `ROOM_STAGGER_SECS` | 0.2 — per hop, either direction |
| | `boxyFraction` | 0.85 — plane above, circle below |
| | `minSweepDepth` | 0.5 — so nothing divides by nothing |
| | `sweepMargin` | 0.3m — past the outline, for what leans out of it |
| `NPCs.tsx` | `npcFadeShare` | 0.3 — their share of the room's fade, going out |
| | `npcArriveTail` | 0.15 — the tail of the sweep over which they come back |
| | `npcSphereY` / `npcSphereRadius` | 0.96 / 1.15, in **model** units (`npcScale` is on the group) |
| `Floor.tsx` | `fadedRoomFloorTint` | 0.1 — `map` mode only now |
| `Obstacles.tsx` | `hiddenTopTint` | 0.1 |

## Things tried and rejected

Kept here so they are not tried again:

- **npc alpha fades of any kind** — a transparent npc writing depth sorts against itself; every
  variant flickered. Discards only.
- **`alphaToCoverage` + `alphaTest`** — three rewrites alpha as `smoothstep(alphaTest, alphaTest +
  fwidth(a), a)`, which flattens a uniform fade to 1.
- **`material.clippingPlanes`** — three's WebGPU renderer ignores it; clipping comes from
  `ClippingGroup` objects in the scene graph.
- **A black disc behind each npc** (opaque, scaled to a point rather than faded) — it worked, but
  the sphere fade made it unnecessary.
- **A closing band** (marks rising from the floor and sinking from the ceiling at once) — doors and
  walls grew out of their own middles rather than up out of the ground.
- **Discarding everything once `mark >= 1`** as a catch-all for stranded broad-wall halves — a pop,
  not a fade. Fixed properly by measuring over both rooms.
- **Sequential floor phase** — a third morph array so the floor went last. Removed in favour of it
  falling out of the sweep.

## Verification

1. `pnpm dev`, multi-room map. Press **3**, **2**, **1** and watch each mode.
2. In `focus`, walk between rooms: rooms open outwards from the player and fold back towards them,
   each sweeping from the door it is seen through. Nothing is left standing — no wall tops, no half
   broad walls, no decor quads.
3. Reverse through a doorway part way through a transition: it carries on from where it is.
4. Click into a room that has gone: the click still lands on its floor.
5. Watch an npc walk into a room that is still sweeping in: they do not dim. Watch one standing in
   such a room: they wait for it.
6. Pause the world and open a door from the terminal: both phases still play.
7. HMR each touched material file, then `fade-rooms.ts` itself, and confirm the mode survives.
