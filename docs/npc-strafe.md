# Npc strafing

An npc **strafes** when it moves without turning to face its path: it keeps its facing and its legs
play a blend of four directional gaits. Backing onto a target close behind (`backstep`) is a
separate, simpler rule, covered at the end.

## Turning it on

`w.npc.move({ ..., strafe })` in `NPCs.tsx` sets the move's intent on `npc.anim`:

- `strafe` defaults to whether they fixate: `strafe ?? Boolean(npc.anim.face.fixate)`.
- Strafing rules out `backwards` and `fast`: one gait blend, never running.
- `turnBeforeMoving` returns at once: they set off without turning.
- The npc tick stops steering `face` by velocity (`face.rate = 0`), so facing holds, unless
  `face.fixate` points them at something.

jsh: `move rob --strafe to:$( pick 1 )`, or `fixate rob at:$( pick 1 )` then any `move`.

## Facing: `face.fixate`

`npc.anim.face.fixate: null | Geom.VectJson` is a point they face whilst set, moving or not. At the
top of `NpcAnimation.tick` it sets `face.target` to its bearing and `face.rate` to `1`, unless a
timed `look` is under way. `demo_sword` fixates on the picked npc every sample.

## The blend

Four clips, a quarter turn apart clockwise from ahead: `strafeClipKeys` =
`walk`, `strafe_right`, `backwards`, `strafe_left`.

- **Shown together.** Whilst `strafe`, `setPose("walk")` fades all four in (and everything else out),
  with base `weight` `1` for `walk` and `0` for the rest; `strafing` records that the four are on
  show. Any other pose fades them all out as usual. The mixer multiplies each fade by that base
  weight, so fading still works whilst `syncStrafe` moves the weights.
- **Weighed by heading** (`syncStrafe`, each moving tick). The heading is their velocity relative to
  their facing. The two clips either side of it share the weight linearly, so the four sum to `1`.
  Each weight eases towards its target over `strafeEaseSecs` (all by the same fraction, so the sum
  holds), which stops a turnabout snapping. Below `0.05` m/s the velocity swings about, so the last
  weights are kept.
- **In step.** All four share `walk`'s time scale and phase; `backwards` is offset half a cycle, as
  it is `walk` reversed, so the same foot swings in all four.
- **Paced to the ground.** `gaitStride` is the metres a cycle of each clip covers, measured off the
  planted foot. The shared time scale is the move's pace divided by the blended stride, so the feet
  match the ground whatever the mix.
- **Sped by heading.** `strafeSpeed` is the top speed each way (sideways slower than ahead); the
  blended speed is the agent's `maxSpeed` each tick. `startMoving` sets `strafeSpeed.walk` until the
  first heading.

`startMoving` re-shows the gait (`setPose` forced) when a move changes between strafing and not.
`moveClipFadedIn`, which holds up arrival until the gait has faded in, counts all four.

The upper-body overlay (`setUpper`, e.g. `point`, `psi`) is unaffected: it blends the arms and head
from whatever the mixer wrote.

## The clips

`strafe_left` and `strafe_right` are in `packages/media/src/blockbench/current/current.bbmodel`.
They were not keyed by hand but **solved from a foot plan**, so a planted foot never slides:

- Timing as `walk`: a 1 s cycle; the right foot swings over `0.05`–`0.45`, the left over
  `0.55`–`0.95` (duty `0.6`). `strafe_left`: the right foot tucks in, then the left steps out.
- A planted foot moves in a straight line at constant speed relative to the body. The swinging foot
  follows a Hermite curve leaving and landing at that speed, lifted by `sin²` (no vertical jolt).
- Feet never come closer than they stand at rest, so they do not clip.
- The hips follow a smooth curve (low Fourier harmonics) fitted just under what the planted legs,
  slightly bent, can reach. The rig's hips are off-centre, so it bobs once per cycle.
- Each leg's hip, knee and foot angles are then solved exactly against the rig's bone lengths, feet
  kept flat, and keyed at 24 samples a cycle. The torso and arms stay upright.
- `strafe_right` is `strafe_left` mirrored (left and right bones swapped, `y`/`z` rotations negated)
  and offset half a cycle, so the right foot still swings first.

Stride `0.6` model units per cycle, i.e. `0.41` m in game — `gaitStride`'s strafe entries. Change
the clips and those must be re-measured.

**Regenerating** — `scripts/src/bins/gen-strafe-keys.ts` does the solve, reading the leg bones from
`current.gltf`; its flags are the plan's parameters (`--stride --duty --lift --soft --harmonics --gap`).
It prints the keyframes as JSON, or with `--blockbench` a snippet to paste into Blockbench's console
(or run via its MCP `risky_eval`): it keys `strafe_left`'s legs and hips, keeps its torso and arms,
and regenerates `strafe_right`. Then export `current.gltf`.
```sh
node scripts/src/bins/gen-strafe-keys.ts --stride 0.6 --harmonics 2 --blockbench | pbcopy
```

## `backstep`

Separate from strafing: with `w.npc.move({ ..., backstep: true })` (jsh `move --backstep`), a target
within `npcConfig.dist.backStep` and more than `npcConfig.angle.backStep` from their facing is
**backed onto** (`backwards`) rather than turned to — see `isBackStep`. Off by default. An explicit
`backwards` wins, and strafing wins over both. For `wasd_delta rob | move rob --backstep`, holding
`s` then backs up instead of turning round again and again.

## Where

- `components/npc-animation.ts` — `setPose`, `syncStrafe`, `startMoving`, `face.fixate`
- `components/NPCs.tsx` — `w.npc.move`, `turnBeforeMoving`, the tick's facing, `isBackStep`, `moveClipFadedIn`
- `const.npc.ts` — `gaitStride`, `strafeSpeed`, `strafeEaseSecs`, `npcConfig.{angle,dist}.backStep`
- `packages/cli/src/jsh/world/core.ts` — `move --strafe --backstep`, `fixate`
