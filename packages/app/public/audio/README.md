# Audio samples

The footsteps (`steps/`), and recorded layers of the sound effects (`sfx/`).

Ten steps from "Footsteps, Tile, Male Sneakers, Slow Pace" by SpliceSound,
https://freesound.org/people/SpliceSound/sounds/170506/, at 1.75, 3.73, 5.02, 8.89, 19.29, 19.90, 21.96, 9.47, 11.31
and 20.58 s: the louder first, then some softer.

Each step is cut from 5 ms before its onset, found by walking back from its peak until 30 dB below it, to 0.32 s past
its peak (0.6 s at most). Nothing else is done to it but a 3 ms fade in and a 30 ms fade out, a peak at -3 dB, and
re-encoding as mono 128 kbps mp3 at 48 kHz, the source's own rate.

Two more sets on tile, cut the same way: eight steps each from "Footsteps, Tile, Male Tennis Shoes, Fast Pace" by
SpliceSound (`tile3`), https://freesound.org/people/SpliceSound/sounds/170501/, and "Footsteps on Tiles" by
RutgerMuller (`tile4`, the default), https://freesound.org/people/RutgerMuller/sounds/50725/.

Used under the Creative Commons 0 license, https://creativecommons.org/publicdomain/zero/1.0/

## Sound effects

Layers of the synthesised effects, each from a CC0 pack by Kenney (www.kenney.nl), via OpenGameArt:

- "Sci-Fi Sounds", https://opengameart.org/content/sci-fi-sounds: `armour-0..4` (`impactMetal_000..004`).
- "50 RPG sound effects", https://opengameart.org/content/50-rpg-sound-effects: `grip-0..3` (`handleSmallLeather`,
  `handleSmallLeather2`, `beltHandle1`, `beltHandle2`), `cloth-0..3` (`cloth1..4`), `click-0..1` (`metalClick`,
  `metalLatch`), `thud-0` (`dropLeather`), `book-0..2` (`bookPlace1..3`).

Each is cut as the steps are: mono at 48 kHz, from 5 ms before its onset (found at -40 dB) to at most 0.5 to 0.7 s, a
3 ms fade in and a 40 ms fade out, a peak at -3 dB, then 128 kbps mp3.

Door sounds, from Freesound (CC0), cut the same way to the hit, at most 0.3 s (the doubles to their second hit):

- `lock-0`: "Metal-Framed Glass Sliding Door - Lock and Unlock" by KoimeMatsuchiya,
  https://freesound.org/s/874652/, at 6.0 s.
- `clunk-0`: "beating-shower-door-05.wav" by Diamond00744, https://freesound.org/s/495503/.
- `clunk-1`: "20231228 - Düsseldorf U-bahn doors open doors close" by LG, https://freesound.org/s/718047/, at 5.3 s.
- `clunk-2`: "door closing.mp3" by nichols8917, https://freesound.org/s/339632/, at 1.3 s.
- `clunk-3`: "Elevator door-close.wav" by Deathscyp, https://freesound.org/s/447875/.
- `clunk-4`: "SFX Door Close Big.wav" by Paul368, https://freesound.org/s/264060/.
- `clunk-5`: "pine door shut 2 - slam.wav" by Imitatia Dei, https://freesound.org/s/96472/.
- `clunk-6`: "Glass Door Closing 1_1" by Joao_Janz, https://freesound.org/s/485111/.

Psi chants, from Freesound (CC0): 11.5 s of each, from the second given, mono 96 kbps mp3. They are looped in code,
each pass crossfaded into the next, so their ends need not meet.

- `psi-0`: "Low_D_Arh.wav" by annannienann, https://freesound.org/s/8067/, from 9 s.
- `psi-1`: "Low chant.wav" by adharca, https://freesound.org/s/319253/, from 1 s.
- `psi-2`: "Atlante 4" by Kronek9, https://freesound.org/s/702653/, from 14 s.
- `psi-3`: "Short eerie chorus" by ThomEvans, https://freesound.org/s/437475/, from 12 s.

Electricity, from Freesound (CC0), from each onset: zaps 1.2 s, shocks and static 0.8 s, sparks 0.35 s, the last
third faded.

- `zap-0`: "Electric" by D4XX, https://freesound.org/s/567269/.
- `zap-1`: "taser.wav" by birdswkaren, https://freesound.org/s/540012/.
- `zap-2`: "Electricity 4" by PureAudioNinja, https://freesound.org/s/341612/.
- `zap-3`: "highvoltagearc.wav" by Sclolex, https://freesound.org/s/210878/.
- `zap-4`: "Zap.ogg" by egomassive, https://freesound.org/s/536741/.
- `zap-5`: "Synthesised Electricity" by RICHERlandTV, https://freesound.org/s/661677/.
- `shock-0`: "Shock_One.wav" by Nodgez, https://freesound.org/s/488665/.
- `shock-1`: "Welding_Electric Sparks.wav" by weaveofkev, https://freesound.org/s/396240/.
- `shock-2`: "welder 4.wav" by SpeedY, https://freesound.org/s/62925/.
- `static-0`: "Electro_Static.mp3" by FireSail_Labs, https://freesound.org/s/108859/.
- `spark-0`: "Spark.wav" by BMacZero, https://freesound.org/s/94132/.
- `spark-1`: "Oven Spark" by DaniloSFX, https://freesound.org/s/672753/.
