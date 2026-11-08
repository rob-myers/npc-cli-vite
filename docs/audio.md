# Audio

The page's sound: one engine, the player's footsteps (one each time a foot of theirs lands), the phaser's and the
doors' sounds, the Audio pane's desk, and the jsh commands that play them in the World. The ONLY doc for it.

| file | what |
| --- | --- |
| `ui/audio/src/engine.ts` | the engine: `getAudio()`, `warmAudio()`, its buses and API |
| `ui/audio/src/steps.ts` | the desk's settings (`audioDefaults`, `audioRanges`), the sets of footsteps, a step |
| `ui/audio/src/samples.ts` | the sample banks (`sampleFiles`), loading them, `pickSample` |
| `ui/audio/src/sfx.ts` | the sound effects' keys (`sfxKeys`), `playSfx`, and the held voices (`holds`) |
| `ui/audio/src/phaser.ts` | the phaser's sounds, and its charge (`chargeVoice`) |
| `ui/audio/src/doors.ts` | the doors' sounds, and a door moving (`doorVoice`) |
| `ui/audio/src/synth.ts` | builders the effects share: envelopes, noise, crackle, a recorded layer |
| `ui/audio/src/nodes.ts` | node builders, a noise buffer, the room and the hall |
| `ui/audio/src/items.ts` | items put down and taken up |
| `ui/audio/src/Audio.tsx` | the desk: a strip per channel, the help tour, the node graph |
| `ui/audio/src/graph-data.ts` | the node graph's layout. Keep it in step with the engine |
| `cli/src/jsh/world/audio.ts` | jsh `sounds` and `sfx`, and reading the player's footfalls |
| `app/public/audio/` | the samples, `steps/` and `sfx/`, with a README of their sources and licence |

## The engine

- **One per page.** `getAudio()` makes it on first use: one `AudioContext` and a master bus.
  - The bus is a limiter (`limiter` in `nodes.ts`, catching peaks over -6 dBFS), then an analyser, then the speakers.
    Near the default faders an effect or a run's step peaks about -6 dBFS (`sfxLevel`, `stepLevel`).
  - **Buses.** The steps, `fx` (the phaser) and `world` (the doors) each have their own level (`sfxBus`, `holdBus`).
  - **The room.** The fx and world buses send a little (`roomWet`) to a small hard room (`room` in `nodes.ts`, 0.45 s of noise
    dying away). The steps stay dry, as their recordings have their own.
  - **Sleeping.** After `idleSecs` (10 s) without a sound the context is suspended, sparing the audio thread, and the
    next sound resumes it. It sleeps only once all is silent, and wakes from silence, so neither pops.
  - The steps and the fx each reach it through their own level. Whilst not playing, `footfall` drops the steps.
- **Importing it.** Import the subpath `@npc-cli/ui__audio/engine`, never the package root (see `docs/deploys.md`).
- **The World never imports it.** jsh plays sounds for it.
- **Autoplay.** Browsers start a context only after a press or key. The engine resumes on the next `pointerdown` or
  `keydown`. `warmAudio()` waits for one of those before making the engine, so nothing is refused at page load.
- **Samples.** All CC0, in named banks (`sampleFiles`), fetched as the engine is made, bar the lazy `psi`: 26 steps (216 KB) and the
  effects' layers (252 KB). `pickSample` never plays one twice running. A layer not yet loaded is left out.
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
  - `sfx(key, { pan, gain, amount, voice, speed })`, `amount` from `0` to `1` (e.g. a shot's charge), `voice` a
    door's, and `speed` the World's time scale: slower plays slower and lower, as tape does (no slower than 1/8).
    - Each plays a little louder or softer, and higher or lower (`varyBy`), so no two alike.
    - **A budget.** At most `maxVoices` (24) sound at once (`voices`): more are dropped. So is a twin, the same key
      again within `twinSecs` at about the same pan.
  - `hold(key, id, { level, pan, gain, voice })` holds a voice by `id`: a phaser charging (by npcKey), or a door
    moving (by where it is, so both sides of a hull door hold one).
    - It is eased towards its params only when they change.
    - Unless held again within `leaseMs` (250 ms) it fades out, as when the World pauses. `release` fades it at once.
  - `subscribe(fn)`, called on every change of status or config, never per frame.
  - `chosenVoices`, door voices chosen by hand (jsh `doorvoice`), kept until the page reloads.

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
  - Sat or lain (`isNotStanding`), their feet are not read, so shifting in a seat or rolling over in bed steps
    nowhere. Up again, their feet are read afresh.
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

## Phaser sounds

Synthesised, over a few recorded layers (`phaser.ts`).

| key | when | sound |
| --- | --- | --- |
| `raise` | `phasers` armed | a sleeve's rustle, a leather grip, a click as it settles, a soft knock |
| `lower` | `phasers` not armed | a click as it is made safe, a rustle, the leather taking it back |
| `charge` (held) | `w.phasers.isCharging` | a low tone throbbing faster as it fills, 3 to 18 times a second, with a swell of air |
| `charged` | the charge reaching full | a snap of current |
| `fire` | `phaser-fired` | a recorded zap of electricity (`zap`, six), its body lifted and fizz eased (`zapBody`, `zapSoft`): a tap as recorded, a full charge lower, louder and longer (`zapRate`, `zapSecs`) |
| `cool` | a charge cancelled (`isCooling`) | its pulse slowing, sinking and fading, the air falling away |
| `hit` | `npc-shot` hit, and `phaser-struck` | a recorded electric hum (`shock`, one): a shot striking anyone, or a wall |
| `armour` | `npc-shot` armour | a recorded plate pitched down, over a padded thud and a low knock |
| `ghost` | `npc-shot` ghost | recorded static (`static`) as it passes through them, then `hit` as it strikes beyond |

- A one-shot's key goes in `sfxKeys` and its builder in `phaserSfx`. Label it in the desk's `sfxLabels`.
- A held voice's key goes in `holdKeys` and its builder in `holds`: it returns `set` and `stop`.

## Door sounds

On the `world` bus (`doors.ts`).

| key | when | sound |
| --- | --- | --- |
| `door` (held) | a heard door's open ratio changing | a rail's rumble, brighter and louder the faster. `air` adds a soft hiss |
| `opened`, `closed` | `door-open`, `door-closed` | a recorded clunk (`clunk`, seven), louder the faster it came |
| `lock` | `door-locked` | a recorded bolt (`lock`) |
| `unlock` | `door-unlocked` | the same bolt, a little higher |
| `hold`, `unhold` | `door-toggled` held, or let go | a latch click, and a low tone rising, else falling |
| `denied` | `door-denied` | a low buzz, twice, at most every `deniedSecs` per door |

- **A door moving** is read, not told: each tick jsh reads each heard door's open ratio, and holds its voice with
  its speed as `level` (`syncDoors`). So it follows the door however it moves, reversing, snapping or slowed.
- **Voices** (`doorVoices`): `glide` and `air`. A door's is chosen by hand (`doorvoice`), else its map's
  `meta.voice`, else one of them by its key.

## Posture sounds

On the `world` bus (`posture.ts`): their clothes rustling (`cloth`).

| key | when | sound |
| --- | --- | --- |
| `sit` | `npc-do` onto a doable with `meta.do: "sit"` | a rustle |
| `lie` | `npc-do` onto one with `meta.do: "lie"` | a rustle, slowed so it lasts longer |
| `stand` | `npc-do` with no doable, after one | a rustle |

Only one settling onto it is heard: `npc-pre-do` comes first. One spawned onto it, as a map's npcs restored, is
silent. Getting off is heard after either.

## Psi

Whilst the player's psi is raised (`w.e.isPsiRaised`), something sings (`choir.ts`, on the `world` bus): what the
desk's **psi** picker chooses (`psiVoices`, saved with the pane). That is the synthesised `choir` or `monk`, one of the
recorded chants (`low-d`, `low-chant`, `drone`, `eerie`), else `random`: the choir `choirShare` of the time, else
a chant. A change of it whilst raised is heard at once. Either is a held voice,
renewed each tick, so a pause or psi lowered lets it die away. It swells in over `fadeInSecs`, dies away over
`fadeOutSecs`, and is never panned, as it is the player's own.

- **The choir**: chanting as monks do, made to sound sung, not played.
  - **Voices**: low voices on D2 A2 D3 over basses on D1, each a throat-like source (`getThroat`, a periodic wave
    whose harmonics fall away as a voice's do), not a sawtooth.
  - **Unsteady**: each singer's pitch wanders a few cents at random (`driftCents`), with a slow vibrato, and scoops
    up onto the note as a phrase starts (`scoopCents`).
  - **Groups**: three, each with its own mouth a little longer or shorter (`mouthScales`), pitched a few cents apart,
    entering and turning vowel `staggerSecs` after the last, each with a breath in first.
  - **Phrases**: long and dark (`phraseSecs`, 14 s), each one of `chants` ("aum", "om", a hum, an open "aah"), its
    vowels shaped by `vowels` and `lipsHz`, then easing for a breath. A narrow resonance drifts over it, picking out
    overtones (`overtoneHz`). A singing bowl is struck now and then (`strikeBowl`, `bowlSecs`).
  - **Melody**: it wanders D Dorian (`modeCents`), a step or two a note, drawn home to D the further it strays
    (`walk`). Each phrase holds a note, steps to another `stepShare` of the way in, then falls a step to close,
    `closeSecs` before its breath. Singers and basses move as one.
  - **Each singer their own**: a source brighter or darker (`throatTilts`), their own vibrato, loudness and drift,
    and a few cents off their place (`detuneStray`).
  - In the hall, beside its own voices (`choirHallWet`).
- **The monk**: one low voice on D2 (`voiceHz`), as the choir's singers are, singing its phrases, overtones and bowl,
  far off in the hall: it answers after `preDelaySecs`, far louder than the voice itself (`monkHallWet`, `monkDry`).
- **The hall** (`hall` in `nodes.ts`): 9 s of stone, losing its highs as it dies (`hallBright`, `hallDull`).
- **A chant**: one of the four `psi` recordings, never the same twice running. The four are fetched together
  the first time any is wanted (542 KB), but each is decoded only once it is itself wanted (`hasSample`, a lazy
  bank's), as decoded each is about 2.2 MB. The choir sings until it has, then fades as the chant swells in. It is looped in code: each pass
  skips the mp3's padding and starts `chantCrossSecs` before the last ends, crossfaded at equal power.
- The desk's world strip has the **psi** picker, and a **psi** button that sings what it chose for a few seconds.
- The chants are the largest samples: 542 KB of mp3, about 8.8 MB decoded, so they are fetched only once one is wanted, and each decoded only once wanted.

## Items

On the `world` bus (`items.ts`), on `item-handled`: an item changing hands, after their reach, `taken` or put down,
maybe on the `floor`. Heard as `put` or `take` with its `kind`.

| kind | put down | taken up |
| --- | --- | --- |
| `book` | a recorded book set down (`book`) | a rustle, and the book lighter |
| boxes | a padded thud (`thud`) | a rustle and a leather handle (`grip`) |
| `keycard` | a small click | a rustle and a lighter click |
| `phaser` | a clunk on plate | a rustle and a click |

Put down on the floor, it is louder than on a surface.

## The desk

The Audio pane, `Audio.tsx`: strips for steps (a button to hear one, shift for running), fx (a button per sound), and
master. The fx strip's **charge** fills a charge over 1.2 s, holds it, then fires: shift cancels it, and it cools.
Shift on **fire** fires a tap, uncharged. The world strip moves a door of each voice as the World does, then stops
it open, shift for shut, and plays each other door sound.

- **Changes.** A fader calls `set`. Every change, from jsh too, is saved into the pane's `meta.config`, and
  pushed back into the engine on mount. A saved config the schema cannot read is dropped.
- **Live meters.** The meters and spectrum are drawn each frame only whilst the master strip's waveform button is
  on, which is off at first and never saved, and only whilst the desk is in sight.
- **Pausing.** The pane's `disabled`, set by its tab's button or the desk's pause, pauses the steps only. Sound
  effects still play. Only a change of it acts, so a mount leaves the steps be.
- **Closing the pane** leaves the engine playing.

## jsh

```sh
sounds                   # footsteps and phaser sounds, in the default profile (idempotent)
sounds set:tile3         # which footsteps, as the desk's buttons choose
sounds off
sfx fire                 # any of sfxKeys
sfx fire amount:0.2      # a shot charged a fifth
sfx armour rob           # heard where rob is
doorvoice                # the doors the player hears, and their voices
doorvoice air            # every door's voice, until a reload
doorvoice g1d19 glide    # one door's
doorvoice off            # each door its own again
```

- **What `sounds` does.** Each tick it reads the feet and the charge of those `heard`: the player, and the npcs near
  them as above. It plays a step per footfall, and holds a charge whilst they charge (`syncCharge`).
  - It listens too: `phasers` plays `raise` or `lower`, `phaser-fired` plays `fire` by its charge at whoever fired,
    and `npc-shot` its outcome (`hit`, `ghost`, `armour`) at whoever was shot. `phaser-struck` plays `hit` where a
    shot at no one struck, as it would striking anyone.
  - It listens to the doors too: see Door sounds.
  - **Who is heard.** A one-shot plays only if one of its npcs is in reach: the player, and npcs in reach of them
    through open doors within `reachMetres` (20 m). A door is heard if it is a door of the player's room, of a room
    beyond its open doors, or of one beyond those (`doorsInReach`). Without a player, all are heard.
  - Its tick keeps the closure of the `sounds` that made it. So after an edit of jsh `audio.ts`, run `sounds` again.
  - `phaser-fired` is emitted by `w.phasers`: by `shoot` as a beam locks on someone, and by `fireAlong` for a shot at
    no one (see `docs/engagements.md`).
- **Where a sound is heard** (`heardAt`). It is panned by where it is across the view, along the camera's right. It
  is quieter the further it is from the view's centre (`heardConfig`).
