# Audio samples

The player's footsteps. The weapon sounds are synthesised, so need none.

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
