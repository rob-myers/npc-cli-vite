# Audio

The page's sound: one engine, the player's footsteps (one each time a foot of theirs lands), synthesised weapon
sounds, the Audio pane's desk, and the jsh commands that play them in the World. The ONLY doc for it.

| file | what |
| --- | --- |
| `ui/audio/src/engine.ts` | the engine: `getAudio()`, `warmAudio()`, its buses and API |
| `ui/audio/src/steps.ts` | the desk's settings (`audioDefaults`, `audioRanges`), the footstep samples, a step |
| `ui/audio/src/sfx.ts` | the weapon sounds (`sfxKeys`), all synthesised |
| `ui/audio/src/nodes.ts` | node builders and a noise buffer |
| `ui/audio/src/Audio.tsx` | the desk: a strip per channel, the help tour, the node graph |
| `ui/audio/src/graph-data.ts` | the node graph's layout. Keep it in step with the engine |
| `cli/src/jsh/world/audio.ts` | jsh `sounds` and `sfx`, and reading the player's footfalls |
| `app/public/audio/` | the footstep samples, with a README of their sources and licence |

## The engine

- **One per page.** `getAudio()` makes it on first use: one `AudioContext` and a master bus.
  - The bus is a limiter (`limiter` in `nodes.ts`, catching peaks over -6 dBFS), then an analyser, then the speakers.
    Near the default faders an effect or a run's step peaks about -6 dBFS (`sfxLevel`, `stepLevel`).
  - There is no reverb: the steps' recordings have their own room.
  - **Sleeping.** After `idleSecs` (10 s) without a sound the context is suspended, sparing the audio thread, and the
    next sound resumes it. It sleeps only once all is silent, and wakes from silence, so neither pops.
  - The steps and the fx each reach it through their own level. Whilst not playing, `footfall` drops the steps.
- **Importing it.** Import the subpath `@npc-cli/ui__audio/engine`, never the package root (see `docs/deploys.md`).
- **The World never imports it.** jsh plays sounds for it.
- **Autoplay.** Browsers start a context only after a press or key. The engine resumes on the next `pointerdown` or
  `keydown`. `warmAudio()` waits for one of those before making the engine, so nothing is refused at page load.
- **Samples.** Only the footsteps: 26 CC0 steps in three sets, about 216 KB, fetched as the engine is made.
- **Hot reload.** The context, samples, listeners, config and status are kept on `import.meta.hot.data`.
  - An edit of any audio module re-runs `engine.ts`, which replaces the engine an older copy made.
  - Vite runs no `dispose` for a module that is not itself the boundary, so the swap is done at the module's top.
  - The samples are fetched again only if `samplesKey` changed.
- **Its API:**
  - `status` (`stopped`, `playing`, `paused`), playing from the first, with `play()`, `pause()` and `stop()` for the
    desk.
  - `set(partial)` changes the config. Unknown keys are dropped, and values are kept within their range.
  - `footfall({ side, run, level })`, heard at once whilst playing. `step` plays one whatever the status, as the desk
    does.
  - `sfx(key, { pan, gain })`.
  - `subscribe(fn)`, called on every change of status or config, never per frame.

## Footsteps

- **Synced to feet** (`footfalls`, in jsh `sounds`), not to World events: the player's, and those of npcs near them.
  - Every `everySecs` (0.5 game seconds) it finds the npcs in reach of the player, through open doors
    (`w.e.getNpcsInReach`), within `hearMetres` (10 m), the nearest `maxNear` (6). Each tick it reads only their feet,
    and the player's.
  - An npc's step is quieter (`npcLevel`), fading with distance to silence at `hearMetres`, and panned by where they
    stand across the view (`heardFrom`). So one walking away fades out before they are dropped.
  - Each tick it reads the height of each foot bone (`leftfoot`, `rightfoot`) above their position, from the world
    matrix the last render left: no matrix is worked out afresh, and it is a frame late at worst.
  - Each foot keeps a floor: the lowest it has been lately, rising slowly (`floorRise`) to follow a crouch or a slope.
  - A foot rising `liftMetres` above its floor is lifted. Coming back within `plantMetres`, it lands, and a step plays,
    panned a little to its side.
  - So walking, running, strafing, crouching and turning on the spot all step as the animation does.
  - A foot lifted longer than a stride (`strideSecs`) has its floor set afresh. So do both on setting off, or when the
    ground jumps (`jumpMetres`), as getting up off a chair, so the first steps after are never missed.
- **A step** (`steps.ts`): one of the chosen set's recorded steps on tile, as recorded, never the same twice running,
  a little louder or softer each time, panned a little to its foot.
- **The sets** (`stepSets`): `tile` (sneakers), `tile3` (tennis shoes), `tile4`, the default. The player's is chosen on
  the desk, where a button per set plays a step and uses it, saved with the pane (`meta.stepSet`), or by
  `sounds set:`. Each npc has one of them at random, the same each time (`setOf`).
- **Its level** follows the gait (`footfallOf`, `stepLevels`): louder the faster, quieter turning, and much quieter
  crouched.
- **The samples** are cut from the recording unprocessed, each from its true onset: see the samples' README.
- **Saved settings.** The desk saves only what differs from `audioDefaults`, marked with `audioConfigVersion`. Bump it
  when the defaults change in a way old desks should not keep: a desk saved against another version starts afresh.

## Weapon sounds

All synthesised, playing at once.

| key | when | sound |
| --- | --- | --- |
| `phaser` | `phaser-fired` | a bright tone diving, bent fast by another, through a sweeping band-pass, with a crackle |
| `hit` | `npc-shot` hit | a burn: a hiss and crackle flaring then sizzling away, over a soft thump |
| `armour` | `npc-shot` armour | a clunk and a chink: a dull knock on plate, and a bright ring off it |
| `ghost` | `npc-shot` ghost | static as it passes through them, then `wall` as it strikes beyond |
| `wall` | `phaser-struck` | a short crack and thud, and a few sparks |

To add one, add its key to `sfxKeys` and its builder to `sfx`. Then label it in the desk's
`sfxLabels`.

## The desk

The Audio pane, `Audio.tsx`: strips for steps (a button to hear one, shift for running), fx (a button per sound), and
master.

- **Changes.** A fader calls `set`. Every change, from jsh too, is saved into the pane's `meta.config`, and
  pushed back into the engine on mount. A saved config the schema cannot read is dropped.
- **Live meters.** The meters and spectrum are drawn each frame only whilst the master strip's waveform button is
  on, which is off at first and never saved, and only whilst the desk is in sight.
- **Pausing.** The pane's `disabled`, set by its tab's button or the desk's pause, pauses the steps only. Sound
  effects still play. Only a change of it acts, so a mount leaves the steps be.
- **Closing the pane** leaves the engine playing.

## jsh

```sh
sounds                   # footsteps and weapon sounds, in the default profile (idempotent)
sounds set:tile3         # which footsteps, as the desk's buttons choose
sounds off
sfx phaser               # also hit, armour, ghost, wall
sfx armour rob           # heard where rob is
```

- **What `sounds` does.** Each tick it reads the feet of the player and the npcs near them as above, and plays a step
  per footfall.
  - It listens too: `phaser-fired` plays `phaser` at whoever fired, and `npc-shot` its outcome (`hit`, `ghost`,
    `armour`) at whoever was shot. `phaser-struck` plays `wall` where a shot at no one struck.
  - `phaser-fired` is emitted by `w.phasers`: by `shoot` as a beam locks on someone, and by `fireAlong` for a shot at
    no one (see `docs/engagements.md`).
- **Where a sound is heard** (`heardAt`). It is panned by where it is across the view, along the camera's right. It
  is quieter the further it is from the view's centre (`heardConfig`).
