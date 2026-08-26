# Static lighting — design note

A record of the static-light approach built and then reverted, so it can be rebuilt with
modifications. Everything below was implemented and typechecked; **none of it was verified running**
beyond "lights appear, walls shadow them".

## The idea

The map's own lights are `decor` circles with `meta.light === true` (see `getLightMetas`). Each gets a
**polar visibility table** — the same structure `service/player-light.ts` sweeps for the player: for
each of N angles, the distance to the nearest occluder. A material asks "can light *i* see this world
XZ?" with one table read.

What makes many of them affordable is that they never move, so their occluders split in two:

- **Walls** never change → each light's table is swept **once per map** and kept. That is the
  expensive half (every wall in reach × every angle) and it never runs again.
- **Doors** change, but a door only darkens a contiguous **range of angles** — the arc it subtends,
  which is fixed however far the door has swung. Those ranges are computed alongside the bake, so a
  frame re-sweeps a few dozen angles rather than a table.

A light is touched only when one of *its* doors moves, so most frames do nothing at all.

Switching a light off is not a sweep either: the table holds what a light can **see**, which is a fact
about the walls, not about the light. So on/off is one float, and the table survives intact.

## Placement constraints

The design leans on three rules, each of which buys something concrete. `syncMap` warns when they are
broken rather than assuming them.

| Rule | What it buys |
|---|---|
| ≤ 3 doors within reach | Fixed-size per-light door list; a bounded per-frame dispatch |
| ≤ 1 other light overlapping | **At most 2 lights cover any point** → a fragment needs at most 2 table reads, and the existing two-slot packing in `Walls`/`Obstacles` becomes *exact* rather than a nearest-2 heuristic |
| Never inside a doorway | A door's arc stays narrow and never wraps past 0, so treating it as one index range is valid |

## Data layout

All `attributeArray` storage buffers, sized by `MAX_STATIC_LIGHTS` (128) and `staticLightAngles` (256).

```
lightData      vec4  per light   [x, z, radius, on]
lightTint      vec4  per light   [r, g, b, _]     meta.tint, pre-scaled
wallRanges     vec2  per light   [start, count] into wallSegs
wallSegs       vec4               every light's walls, concatenated
doorRanges     vec4  per (light, slot≤3)  [doorInstanceId, firstAngle, angleCount, _]
doorSegs/Gaps/Open   per door instanceId  (indexed, not packed — a light names doors by id)
gmRanges       vec2  per geomorph [start, count] into gmLightIndices
gmLightIndices float              which lights reach each geomorph

wallTable      float  MAX_LIGHTS × ANGLES   walls only; written by the bake, never again
table          float  MAX_LIGHTS × ANGLES   what materials read
```

## The two compute passes

**`bakeSweep`** — one thread per table entry, so the flat index *is* the entry. Walls only. Result
goes into both `wallTable` (what a door sweep starts from) and `table` (because with every door shut
that is already the answer). Dispatched once per map change.

**`doorSweep`** — one thread per `(stale light, door slot, angle within that door's range)`. Fixed
dispatch shape (`maxDirtyLights × 3 × maxRangeAngles`), almost all of which return immediately.
Skipped entirely when nothing is stale.

Each thread tests **all** of its light's doors, not just the one whose range it belongs to — two
ranges can overlap, and both threads must reach the same value rather than race to different ones.

Staleness: CPU compares each door's `openRatio` against what it was when last swept, and marks the
lights that door reaches (`lightsByDoor`).

## Light selection — the part that actually bounds per-fragment cost

Two different answers, because the geometry differs:

- **Floor** — drawn one instance per geomorph, so `instanceIndex` *is* the geomorph. That bounds which
  lights could matter: `contributionAtGm` loops that geomorph's list (≤32, distance-rejected before
  the table read). Per-geomorph lists are built **by reach**, not by which geomorph the light stands
  in, so a light near a hull door lights its neighbour.
- **NPCs** — an npc is effectively a *point*, and by constraint (b) at most 2 lights cover a point. So
  the CPU names them (`coveringPair`, a handful of distance tests in the existing per-npc tick) into a
  `vec2` uniform, and the shader does **no loop at all** — two table reads flat.

`Walls` and `Obstacles` were never wired up. They already carry a two-slot light packing, so they are
the natural next consumers of `contributionAtPair`.

## The illumination convention (learned the hard way)

**Light is added, never subtracted.** A surface sits at `ambient` where nothing reaches it, and each
light adds its share on top:

```
illumination = ambient + playerTint·playerLit + Σ lampTint·lampLit
colour       = albedo × illumination          // one multiply, at the end
```

This was not the first attempt, and the first attempt is instructive:

- Originally `player-light`'s `applyLight` **darkened** what the player could not see (`unlitTint`),
  the floor texture **baked** a per-room darkening, and lamps **multiplied up**. Three sources of
  darkness in two opposite conventions. A lamp-lit room the player could not see was brightened by the
  lamp and then immediately taken back to 30% by the tint.
- That forced a fudge (`withPlayerLight`, damping lamps where the player already saw) purely to stop
  the two compounding. Once everything became additive the fudge disappeared, because two lights
  falling on a spot simply sum.
- Consequence: the baked `drawRoomDarkeningIntoTexture` was deleted, since `ambient` now covers it.
  **Watch for this on a rebuild** — the baked version was clipped to *rooms*, so corridors were not
  darkened; `ambient` is uniform. If the room/corridor distinction matters it has to come from the
  illumination side.

Also: light on a surface is **multiplicative**. Adding a constant lifts every part of the texture by
the same amount, so dark art rises further than light art and the detail flattens. Multiplying scales
contrast with brightness.

Tinting: use a **tint**, not a colour. `#99f` used directly is `(0.6, 0.6, 1)` — a 20% luminance loss
dressed up as a hue. Lerp from white by an amount, then normalise back to white's luminance, so it
colours the light without dimming it. Keeps "how blue" and "how bright" independent.

## Gotchas that cost real time

1. **Decor circle centres are already world-space.** `instantiateDecor` puts `d.center` through the
   geomorph matrix (`geomorph.ts`), unlike `wallSegs`/`gm.rooms` which stay in layout space. Three
   separate places double-transformed lights: `Obstacles.tsx` (still does — its skirt lighting is
   clamped to 0.05, which is why nobody noticed), `Debug.tsx`'s light spheres, and the first draft of
   `static-lights.ts`.

2. **TSL `Loop` / `If` / `toVar` emit *statements* and need an enclosing `Fn()`.** Called at
   material-build time with no shader-function stack, they silently emit into nothing and the feature
   never appears — with no error. `player-light`'s `litAt` gets away with being a bare function only
   because it is pure expressions. This cost an entire debugging round.

3. **`attributeArray` + `needsUpdate` uploads the whole buffer.** `WebGPUAttributeUtils` writes the
   entire array unless `addUpdateRange(start, count)` is set (start/count in *elements* for a typed
   array; three clears the ranges after uploading). Worth interleaving instanced attributes into one
   `InstancedInterleavedBuffer` too — one `writeBuffer` instead of four.

4. **`time` from `three/tsl` is a plain uniform**, so `time.value` on the CPU is the exact clock the
   shader samples. That makes shader-driven animation from a `[from, to, at]` triple safe — no
   per-frame stepping, no drift, and the same curve however few frames it is drawn over.

5. **Unrelated but found on the way**: `world.css` has `opacity: var(--world-veil, 1)` and
   `veilCanvas` only ever sets that property *inline* on `w.rootEl`. A remounted root element loses
   it, falls back to fully opaque, and nothing lifts it — the whole canvas goes black on HMR.

## Constants worth knowing

| | | |
|---|---|---|
| `staticLightAngles` | 256 | vs the player's 3072 — static radii are small, so the arc between angles is short |
| `MAX_STATIC_LIGHTS` | 128 | 128 × 256 floats ≈ 128 KB per table, ×2 tables |
| `maxLightsPerGm` | 32 | the floor's loop bound |
| `staticLightPower` | 1.8 | what an untinted lamp adds at its centre |
| `ambient` | 0.1 | what unlit comes to — **the single knob for overall darkness** |
| `falloffFraction` | 0.75 | the last fraction of the radius over which a lamp fades |

A debug slider (`setLightDim`) scales every light's **contribution**, leaving `ambient` alone, so at 0
the world falls to its unlit level rather than to black. Useful for seeing how much of the scene is
lighting versus art.

## What I would change next time

- **Wire `Walls`/`Obstacles` early.** The floor alone makes it hard to judge, and their two-slot
  packing already exists.
- **Verify the compute passes before building on them.** The `doorSweep` index arithmetic was never
  exercised — the 301 lights are small enough that none reached a door, so that pass never ran once.
- **Reconsider `falloffFraction`** at small radii. At 0.75 a 1.5 m lamp is full only within 0.375 m and
  is otherwise all falloff.
- **Decide the room/corridor distinction deliberately**, rather than inheriting it from a baked
  texture that then gets deleted.
- **Per-light angle counts.** 256 is generous for a 1.3 m lamp and mean for an 8 m one; scaling with
  radius would spend the budget better.
