# Shields

A shield is a see-through panel that stops phaser fire. Anyone can walk through it. The ONLY doc for it.

| file | what |
| --- | --- |
| `ui/world/src/components/Shields.tsx` | the shields, `w.shields`: which exist, who stands in one, what a crossing does |
| `ui/world/src/service/shield-shader.ts` | how one is drawn, and `shaderConfig`, its look |
| `ui/world/src/components/Phasers.tsx` | where a beam asks the shields to stop it |
| `ui/world/src/worker/ray-cast.ts` | the nav worker's raycast, which reports the shields a ray passes |
| `ui/world/src/service/worker-data.ts` | `isColliderDecor`: a shield is a collider without being tagged one |
| `cli/src/jsh/world/core.ts` | `shield`, `phaser` |
| `cli/src/jsh/world/decor.ts` | `decor`, which makes one |

## Making one

A shield is a decor **rect** whose meta has `shield`. The panel stands on the rect's long centre
line, floor to `wallHeight`. The rect itself is the shield's collider: who is "in" the shield.

```sh
pick 1 | decor key:shield-0 type:rect w:3 h:1 meta:'{ shield: true }'
pick 1 | decor key:shield-1 type:rect w:3 h:1 meta:'{ shield: true, freq: 2 }'
pick 1 | decor type:rect w:3 h:0.15 meta:'{ shield: true, freq: null }'
```

- `decor` leaves a shield's `meta.shown` false unless told otherwise: the panel is what is seen.
- In a symbol it is a `decor rect shield` node, with `freq=2` in its name for a frequency. A rect or
  circle node needs no image to be decor. NOT yet tried in a real symbol.
- A rect under `shieldConfig.minSize` (1m) on either side is ignored, with a console warning. The
  depth is what lowers a raised phaser before its muzzle is through. A shield of no frequency is
  exempt, and may be a thin strip.
- At most `MAX_SHIELDS` (256).

## Frequency

Every shield's decor has `meta.freq`. One made without it is given `shieldConfig.freq` (1), written
into the decor and, for a runtime shield, its saved def.

| `meta.freq` | fire | a phaser carried through |
| --- | --- | --- |
| a number | stopped, unless the phaser knows that frequency | deactivated, unless it knows it |
| `null` | always stopped | untouched |

A phaser's frequencies are on the ITEM: `meta.freqs` of the phaser def in `w.e.carried`, so they
persist and travel with it when dropped. An npc must carry one to be granted any, or armed.

```sh
shield                              # shield-0 freq:1 (on)
shield shield-0 --off               # or --on: off, it does nothing, and is drawn faintly
shield shield-0 freq:3              # or freq:null, written to its meta
phaser rob                          # { freqs, dead }
phaser rob grant:"1 2 3"            # adds to what it knows
phaser npc:rob revoke:"[1, 2]"      # takes from it
phaser rob shoot:npc-0              # raises it, locked on; --raise for no target, --lower to put it away
```

`--on` / `--off` is an override held by `w.shields`, lost when the shield is next made. A frequency
set on a symbol's own shield lasts until reload, as its meta comes from the node's name.

## Stopping fire

A phaser already casts a ray for line of sight: `w.phasers.recast`, a method of `Phasers` which calls
`w.e.raycast` (nothing to do with the Recast navmesh library). It is throttled, and only
once they, their target or a door has changed. Shields ride on it:

1. `Shields.sync` sends every shield's rect to the nav worker (`set-raycast-shields`), where they
   are kept in one world-space system apart from the geomorphs', which a navmesh request clears.
2. A ray notes each shield it crosses and goes on: `w.e.raycast` returns `shields`, nearest first.
   `doors` are nearest first too, and neither includes anything past the wall that stopped the ray.
3. `w.phasers.recast` keeps those keys on the arm. Each tick `Phasers.onTick` calls
   `w.shields.stop(keys, body, tip, part, freqs)`, which takes the first that is on and not tuned
   to, and intersects the beam with its centre line for the exact end.

The beam is cast from the shooter's BODY, at the muzzle's height. If the crossing falls before the
muzzle, the gun has been poked through and the beam ends at the muzzle: it fires nothing.

A shield is its centre line here, so the answer lags as walls do: after a move the beam can pass a
shield until the next cast returns. A beam let go of keeps its last shields, so it fades against them.

## Deactivating a phaser

Carrying an untuned phaser through a live shield of some frequency deactivates it. A dead phaser
cannot be raised; its emitter is blue, in hand and in the bar; the player is told by toast.

The item holds `meta.dead`, the frequencies it is dead to, and fires only whilst that is empty. A
crossing TOGGLES the shield's frequency in it, so in is dead and back out through any shield of
that frequency is live. Granting a frequency revives it of that one.

It happens at the shield's centre line, in either direction: going in kills it, coming back out
revives it. No event tells of that, so `crossLines` checks each tick for whoever stands in a shield's
rect, with `lineSlack` (5cm) past the line before it counts, so someone stood on it does not flicker.

- Anyone entering a live shield's rect lowers their phaser, and it cannot be raised until they leave
  (`w.shields.isIn`). That is what makes the line safe: live or dead, nothing fires from inside.
  The player is told "phaser suppressed": on entering one of a frequency, and on trying to raise it in any.
  They shake their head too, on that try.
- Switching a shield off leaves a dead phaser dead.
- NOT handled: a teleport or spawn skips the crossing, and an npc already in a rect when the page
  loads gets a fresh `enter-collider`.

Psi is not affected by any of this.

## How one looks

Two meshes, both instanced from one buffer of 12 floats a shield (`shieldEnds`, `shieldFx`,
`shieldHit`), placed in the vertex shader rather than by an instance matrix, which alone is four of
the eight vertex attributes allowed.

- **The frame**: four plain dark bars, `rim` wide and `frameDepth` thick, the same on any theme. It
  is laid over what is behind and writes depth, as a solid thing.
- **The field**: slanted hatching that stays put and fades right out and back in every
  `hatchFadeSecs`. Added to a dark deck; laid over a pale one in a dark ink, where light cannot be
  added. 
- **Fired on**: a soft glow where the beam lands, placed from the beam's DRAWN end so it glides
  with it; and the whole field thickens, thinning again over `shieldConfig.struckSecs`.

Things that are not obvious:

- **Coverage.** The post pass (`service/post-processing`) keeps a pixel by how much was drawn there.
  In `sight` mode a wall out of view is not drawn at all, so a faint line before it was thrown away.
  Added, the field's alpha is therefore its COVERAGE, `coverage` times over, and its colour comes
  premultiplied (`addedBlending`).
- **It animates** off a `fade` uniform, which `onTick` works out once a tick from the World's clock. It
  asks for no frames: unpaused, the frameloop is `"always"`, and paused the fade should hold still anyway.
- **HMR.** An edit to the shader can leave the old meshes in the scene beside the new: two
  patterns at once means a reload.
- `paleGain` is large to make thin dark lines show, so anything else scaled by it saturates: the
  glow has its own `paleGlow`. The struck fill does not, and is far stronger on a pale deck.
