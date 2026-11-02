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

- "Sci-Fi Sounds", https://opengameart.org/content/sci-fi-sounds: `armour-0..4` (`impactMetal_000..004`),
  `crunch-0..4` (`explosionCrunch_000..004`), `slime-0` (`slime_000`), `boom-0..1` (`lowFrequency_explosion_000..001`).
- "50 RPG sound effects", https://opengameart.org/content/50-rpg-sound-effects: `grip-0..3` (`handleSmallLeather`,
  `handleSmallLeather2`, `beltHandle1`, `beltHandle2`), `cloth-0..3` (`cloth1..4`), `click-0..1` (`metalClick`,
  `metalLatch`), `thud-0` (`dropLeather`).

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
