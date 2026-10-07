# Npc strafing

An npc **strafes** when it moves without turning to face its path: it keeps its facing and its legs
play a blend of four directional gaits. Backing onto a target close behind (`backstep`) is a
separate, simpler rule, covered at the end.

## Turning it on

`w.e.move({ ..., strafe })` in `use-world-events.ts` sets the move's intent on `npc.anim`:

- `strafe` defaults to whether they aim: `strafe ?? Boolean(npc.anim.face.aim)`.
- **Left to that default, it follows the aim mid-move** (`strafeFollowsAim`): `NpcAnimation.tick`
  calls `setStrafe` as `face.aim` comes or goes, so an npc armed whilst moving strafes at once and a
  disarmed one lets go. A move told `strafe` either way keeps it. Letting go restores the move's own
  `fast` (`fastAsked`), so they run again.
- Strafing rules out `backwards` and `fast`: one gait blend, never running.
- `turnBeforeMoving` returns at once: they set off without turning.
- The npc tick stops steering `face` by velocity (`face.rate = 0`), so facing holds, unless
  `face.aim` turns them.

jsh: `move rob --strafe to:$( pick 1 )`, or `look rob --strafe at:$( pick 1 )` then any `move`.

## Facing: `face.aim`

`npc.anim.face.aim: null | { at, rate, untilRest }` is faced whilst set, moving or not: `at` is a
point, tracked, or a world angle (as `rotation.y`). At the top of `NpcAnimation.tick` it sets
`face.target` to that bearing and `face.rate` to `rate`, unless `face.turn`, a timed turn on the spot, is under way — so
turning to it is the usual exponential ease.

- **A look whilst strafing** (`npc.look` when `strafe` and moving) does not stop them or turn them on
  the spot: it sets the aim to the look's angle, `untilRest`, and returns at once. `startIdle` clears an
  `untilRest` aim, so it lasts for the move, and turns them the rest of the way on the spot, since
  they may arrive before the ease lands. Otherwise a look is the usual timed turn on the spot.
- **jsh `look --strafe`**: `look rob --strafe at:$( pick 1 )`, `look rob --strafe at:1.57`,
  `look rob --strafe at:kate rate:0.5`; a bare `look rob --strafe` clears it. Piped
  (`pick --right | look rob --strafe`), each pick re-aims them until killed, and picking them clears it.
- An armed npc (`w.phasers`, jsh `phaser`, the bar's slot `2` for the player) aims at their target every tick, but
  replaces or clears only an aim it set, so a look still turns them. Armed at nobody, it holds their
  facing with an aim at `rate` `0`, which turns them not at all, so every move strafes — bar one told
  not to, which it leaves to face its path, else its forward gait would slide.
- Psi sets no aim: its contours show where the target is, and the phaser's aim is the only one.

Not to be confused with `NpcAnimation.aimAt`, which aims the crowd at a move's target.

## The blend

Four clips, a quarter turn apart clockwise from ahead: `strafeClipKeys` =
`walk`, `strafe_right`, `backwards`, `strafe_left`.

- **Shown together.** Whilst `strafe`, `setPose("walk")` fades all four in (and everything else out),
  with base `weight` `1` for `walk` and `0` for the rest; `strafing` records that the four are on
  show. Any other pose fades them all out as usual. The mixer multiplies each fade by that base
  weight, so fading still works whilst `syncStrafe` moves the weights.
- **Already walking**, `setPose` keeps `walk` as it is rather than restarting it, which would reset its
  phase and fade its weight in from `0` — the feet popping and the body sagging towards the rest pose.
  The other three start at `0` and `syncStrafe` eases them in.
- **Let go mid-move**, the four stay on show whilst `syncStrafe` eases all the weight onto `walk`, then
  `walk` shows alone. `syncGait` may break into a run meanwhile, crossfading as usual.
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

`startMoving` re-shows the gait (`setPose` forced) when a move starts strafing; one that stops eases
out as above.
`moveClipFadedIn`, which holds up arrival until the gait has faded in, counts all four.

The arm overlays (`setUpper`, e.g. `phaser_aim` on the right, `psi` on the left) are unaffected: they blend an arm and the head
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

Separate from strafing: with `w.e.move({ ..., backstep: true })` (jsh `move --backstep`), a target
within `npcConfig.dist.backStep` and more than `npcConfig.angle.backStep` from their facing is
**backed onto** (`backwards`) rather than turned to — see `isBackStep`. Off by default. An explicit
`backwards` wins, and strafing wins over both. For `wasd_delta rob | move rob --backstep`, holding
`s` then backs up instead of turning round again and again.

## Where

- `components/npc-animation.ts` — `setPose`, `setStrafe`, `syncStrafe`, `startMoving`, `face.aim`
- `components/npc.ts` — `look`, which aims instead whilst strafing
- `components/use-world-events.ts` — `w.e.move`, `isBackStep`
- `components/NPCs.tsx` — `turnBeforeMoving`, the tick's facing, `moveClipFadedIn`
- `components/Phasers.tsx` — `wield`, which sets or withholds an armed npc's aim
- `const.npc.ts` — `gaitStride`, `strafeSpeed`, `strafeEaseSecs`, `npcConfig.{angle,dist}.backStep`
- `packages/cli/src/jsh/world/core.ts` — `move --strafe --backstep`, `look --strafe`
