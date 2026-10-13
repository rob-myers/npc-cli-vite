# Npc breath

The ONLY doc for how an npc breathes: `tickBreath` in `components/npc-animation.ts`, the ghost in
`components/NpcBreath.tsx` and `service/breath-ghost.ts`, tuned by `BreathTune` and `breathConfig` in `const.npc`.

## Who breathes

Nobody, until asked: `npc.anim.setBreathing(true)`. `breath.amount` eases to `breath.on` over
`breathConfig.easeSecs`, and one at rest with it off costs a single test per tick. The bubble's
**breath** button, beside psi and phaser, switches it for that npc. The player's also comes on
whilst their psi is raised, and goes as it is lowered (`w.e.setPsi`).

The player breathes by `w.npc.breathTune`, set by the bubble's sliders (`BreathControls`) and
persisted per World. Anyone else breathes by `defaultBreathTune`.

## The air in their lungs

`lungVolume(phase, inhale)`, `0` to `1`, and the only part that knows about time. Breathing in is
muscle: a smooth rise over `inhale` of the breath. Breathing out is recoil, critically damped: quick
at first, then all but still, which is the pause before the next. `breathConfig.recoil` sets how soon.

`phase` and `rate` are per npc, so one npc's breath can be brought onto another's. Nothing does yet.

## Their body

At rest, an npc's pose is already a breath: `idle`, `breathe`, `sit` and the three `lie` clips each
have them empty at `0` and full halfway, moving the stomach and chest and whatever else that pose
needs. They are `breathClips`. Whilst
breathing is on that clip no longer runs by its own clock. `tickBreath` holds it (`breath.held`, its
`timeScale` at `0`) at the moment it has them as full as their lungs are, by `clipTimeOf`. So the
body the artist drew breathes at the breath's rate and shape, in step with the ghost.

- **Nothing jumps either way.** `setBreathing(true)` starts the breath from where the clip has them
  (`phaseOfClip`), and a clip let go carries on from the time it was held at.
- **Only a pose at rest.** Walking, hurt or pacified, their body is the pose's own and only the
  ghost breathes.
- **How far they move is the clip's**, whatever `reach` says.

## The ghost

Their bones are never written. A breath shows INSIDE them, as a ghost seen through their body
(`createBreathGhost`):

- **A pair of lungs** in the chest, which swell along their normals by `reach` as they fill, and brighten.
- **A diaphragm**, a dome under them. Its crown drops as it contracts and its rim stays put. It is
  brightest under `drive`, the effort of breathing in: breathing out is recoil, and takes none.

How it is built:

- **It is ONE instanced mesh for the World**, `NpcBreath` (`w.breaths`): one draw call however many
  breathe, and none at all whilst nobody does. An npc's own tick only works out their breath
  (`breath.full`, `drive`, `glow`, `reach`). `w.breaths.onTick`, from `postNpcTick`, gives each npc
  breathing an instance.
- **An instance is carried by its npc's chest bone**: its matrix is that bone's world matrix, brought
  up to date first, as the render has yet to. Lungs and diaphragm are rigid to the chest, so nothing
  is skinned, and the geometry is built once in that bone's own frame from `breathConfig`.
- **`normal` is the way a vertex moves**, not its facing: outwards on a lung, straight down on the
  diaphragm. `breathShare` is how far. `breathNow` is the per-instance breath.
- **Looked down on, lungs and diaphragm go faint** (`above`), as there they lie over their own head. Straight
  on they are at full strength. `breathUp` is the way each chest stands, and the test is in the
  shader, so it follows a camera turned whilst the world is paused. One lain is seen straight on from
  above.
- **It is additive and writes no depth.** Its depth is drawn `depthBias` nearer the eye, so it shows
  through their own body yet is still hidden by a wall. An alpha of nought adds nothing, which is how
  it stays out of a pick.

It is not dimmed by the player light or a room's fade, so another npc's shows in the dark.

## Tried and dropped

- Moving the body itself, by scaling the chest and stomach bones. On a figure of boxes it did not
  read as breathing.
- A shell of their whole body, pushed off it and lit by the breath.
- A skinned mesh per npc breathing, sharing their skeleton. It was a draw call and a material each.
- Nerves, a thin prism along each bone with pulses running out from the head.
- Hiding the lungs seen from in front, and drawing them as an outline alone where they cover the head.
