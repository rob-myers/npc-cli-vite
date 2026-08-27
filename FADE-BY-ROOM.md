# Fade by room — design note

A record of the "Fade by room" spike, built and then reverted. Nothing here was verified beyond
"rooms appear and fade"; the performance conclusion at the end is the most useful part.

**The idea.** Instead of the post pass fading the world beyond a circle centred on the player, fade
by *room*: rooms in view are shown, everything else fades away. A circle knows nothing about walls,
so it cuts across rooms and shows slivers of ones the player cannot see into. A room boundary IS a
wall, so fading on rooms lands every edge where a wall already is.

## Which rooms are in view

`roomsInView(w)` in `service/fade-rooms.ts` — the one place that decides:

- the player's own room (`w.e.npcToRoom.get(w.player.key)`)
- plus whatever an **open door** joins it to — a shut door stops the eye as it stops the light
- plus whatever a **window** joins it to, *whatever the window is doing*, since it is glass

That last one matters and is easy to miss: `service/player-light` deliberately leaves windows out of
its occluders, so its polygon already reaches through them. The fade has to follow or a room plainly
visible through a window is faded out.

Not done: **hull doors**, which join two *geomorphs* — `roomsInView` only walks within `at.gmId`.
Nor rooms holding an npc, which was wanted and is a line in that function.

**Resync points**: `door-open`, `door-closed`, the player's `enter-room`, the player's `spawned`, and
`w.gmsHash`. `spawned` is required and not obvious — `fadeSpawn` and teleports set `npcToRoom`
directly and never fire `enter-room`, which only fires for someone who *walked* there.

## Two architectures, and why the second lost

### A — the post pass decides

The post pass reconstructs, per pixel, where the view ray crosses `y = 0` and `y = wallHeight`; the
segment between them is the ray's whole path through the slab a room stands in. Then per room:

- **point-in-polygon at the TOP point** → the ray came in by the room's open lid, so we see inside
- **segment-vs-edge against each room edge** → the ray struck a wall from outside

The lid wins where both are true. Everything else is not drawn at all — it goes to the striped
backdrop like anything nobody drew.

Testing the two *endpoints* for inside-ness is not enough, and this took a while to see: a ray can
enter a room's column and leave it again between the two heights with neither end inside, which is
most of what is seen of a room from outside it. The segment test is what adds the third polygon —
the extruded prism's silhouette — over the flat floor and ceiling ones.

**Cost: once per screen pixel.** That is the whole appeal.

**Limit:** the post pass has one colour buffer and cannot tell a floor pixel from a wall pixel. So
"show the floor and npcs even when looking through a wall" is impossible without an extra MRT
attachment marking what each fragment is — the same machinery the npc outlines used, with the same
`MRTNode.merge` blend-mode bug (see `STATIC-LIGHTING.md`).

### B — each material decides

A material knows two things the post pass never can: **what it is**, and **where its fragment
actually is** (`positionWorld` — no ray reconstruction, no depth). So the whole column apparatus
collapses to a plain point-in-polygon, and "floor and npcs behave differently" is free.

`fade-rooms` then exposes two things a material wraps itself in:

```ts
visibleAt(worldXZ): float     // 1 when the feature is off, so wrapping is unconditional
clipRgba(color: vec4): vec4   // the same, applied to alpha at this fragment's own position
```

**This is what was built, and it is what made it slow.** See below.

## Fading per room

Each room carries `[from, to, at]` in a `uniformArray`, interpolated in-shader against TSL's `time`
— the same clock-driven morph `NpcRings` uses, so nothing is stepped per frame and the CPU only
retargets on `sync`. Two details that are easy to get wrong:

- a room **leaving** view must be kept packed until it has faded out, or it vanishes rather than fades
- overlapping rooms take the **fullest**, not the first: one on its way out must not take away what
  another is bringing in — which is also why the loop cannot break early

`retarget` restarts from wherever a fade has got to, so a room that comes back part way out carries
on rather than snapping.

## Performance — the actual finding

**Two separate problems, and the first is the one that bit.**

### 1. `mix` is not a branch

```ts
// what was written
visibleAt = mix(float(1), insideRoom(worldXZ), enabled)
```

A shader evaluates **both** operands of a `mix` and then blends. So the doubly-nested polygon walk
ran on every fragment of every material **whether or not the feature was switched on** — producing a
value that was then multiplied away, having cost exactly as much as when it was on.

The fix is real control flow inside the `Fn`:

```ts
const amount = float(1).toVar();
If(enabled.lessThan(0.5), () => { Return(); });
amount.assign(0);
… loops …
```

Worth remembering generally: **`mix`/`select` on a uniform is not free**, and a `Fn` with `If`/`Return`
is how you actually skip work in TSL.

### 2. Per-fragment × per-material × overdraw

Even switched on and branched correctly, architecture B pays:

- per fragment: up to 12 rooms × up to 64 verts, each vertex two `uniformArray` reads and ~10 ALU.
  A realistic 4 rooms × 12 verts ≈ 50 iterations ≈ 600 ALU + 100 uniform reads.
- **times every material** — floor, walls (3 materials), doors (3), obstacles (2), decor (2),
  ceiling, npcs — most of them transparent and stacked, so one pixel evaluates the same test five or
  ten times and always gets the same answer.

That is the post pass's single evaluation multiplied by depth complexity.

### The fix that was never built: per **instance**

Almost everything here already knows its room as static CPU data:

| | room known by |
|---|---|
| doors | `connector.roomIds` |
| decor | `meta.roomId` |
| obstacles | decodable per instance |
| walls | needs checking — `wallSegs` carries only `meta` |

For those, `sync` writes a fade **per instance** into a `uniformArray` indexed by `instanceIndex`,
and the shader does **one lookup** instead of ~50 loop iterations. It also removes the `roomOutset`
fudge entirely: an instance either belongs to a room or it does not, so walls stop being decided by
whether their fragments clear a boundary.

Only two things genuinely need per-fragment work: the **floor**, which is one instance per geomorph
and spans many rooms, and **npcs**, which move — and npcs can take a per-npc uniform refreshed in the
tick, exactly as `coveringPair` did for the static lights.

Endpoint: one polygon test per fragment on the floor, one array read everywhere else.

## Smaller things learned

- **Nested `Loop`s share an index name in TSL.** A bare `infos.element(i)` is a node that re-reads
  `i` *wherever it is emitted*, so one captured in the outer loop but used inside the inner one
  resolves against the wrong index. Symptom: the wrong room's offsets, and a vertex count that cuts
  off early. Fix: `.toVar()` in the outer loop to materialise it.
- **Truncating a polygon removes a contiguous run**, so the outline closes straight from the last
  vertex kept back to the first — which reads as "a corner or two are missing", not as garbage.
  `maxRoomVerts` was 24 and `createOutset` returns *more* vertices than it is handed. Warn rather
  than truncate silently.
- **Connectors have depth.** `doorDepth` is 0.5m, `hullDoorDepth` 1.0m, so a room's outline edge
  along a doorway lies that far from the connector's midline. A distance-to-midline test tight
  enough to mean anything never fires. Test against the connector's **rect** instead.
- **A wall belongs to two rooms.** Giving the wall geometry a black back face blacks it for whichever
  room stands on that side — the black backing has to be per (room, wall), not per wall. And walls
  use `createTwoSidedXyQuad`, so `frontFacing` there picks an arbitrary side, not "outside".
- **`getWallMat`'s winding convention was never exercised for single-sided quads**, because walls are
  two-sided. Facing comes from the *order* of the two points handed to it — an offset along a normal
  moves the quad without turning it, which cost a round trip to notice.
- **Materials ignore alpha unless they opt in.** `Obstacles`' skirt material had no `transparent`
  flag, so `clipRgba` there did nothing at all. `alphaToCoverage: true` is usually the right answer
  for solid geometry that must still fade — it keeps the material opaque and depth-writing.
- **`alphaTest` and a fade fight over the same channel.** Obstacle tops use `alphaTest: 0.5` for
  their sprite cutouts, so multiplying alpha by a fade makes the whole top *pop* out when the product
  crosses 0.5 rather than fading. Carry the fade elsewhere, or move to coverage.

## Unrelated bug found on the way

`world.css` has `opacity: var(--world-veil, 1)` and `veilCanvas` only ever sets that property
**inline** on `w.rootEl`. A remounted root element loses it, falls back to fully opaque, and nothing
lifts it — `veilCanvas(false)` is only reached via a map change. That is the whole-canvas-goes-black
on HMR. Fix: track the veil state and reapply it in `setupDom`, which already re-runs on `[w.rootEl]`.
