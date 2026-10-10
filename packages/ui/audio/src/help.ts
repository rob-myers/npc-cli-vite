import type { AmbienceKey } from "./ambience";

/** A stop on the desk's tour: the introduction, then a control */
export type HelpStep = "intro" | AmbienceKey;

export const helpIntro = {
  title: "The desk",
  text: [
    "Three channels feed the master: a synthesised engine, air handling made of filtered noise, and a sampled choir.",
    "Each strip has a fader for its level, with a meter beside it, and knobs for its character.",
    "Drag a knob up or down to turn it, or focus it and use the arrow keys, with shift for bigger steps. A double click restores its default.",
    "Every control still works during this tour, so press play and listen as you go.",
  ],
};

/** What each control does. `live` ones are heard at once, the rest from the choir's next chord */
export const help: Record<AmbienceKey, { title: string; live: boolean; text: string[] }> = {
  drone: {
    title: "Engine level",
    live: true,
    text: [
      "How loud the engine is: two saw waves a shade apart, a sine an octave above, and low rumble.",
      "The two saws beat against each other, which is the slow throb you hear.",
    ],
  },
  droneHz: {
    title: "Engine pitch",
    live: true,
    text: [
      "The engine's note. 36.7 Hz is a low D.",
      "The choir's chords are built on this note, so it retunes the choir too, from its next chord.",
    ],
  },
  droneCutoff: {
    title: "Engine tone",
    live: true,
    text: [
      "A low-pass filter on the engine.",
      "Turned down it is a rumble more felt than heard. Turned up, the buzz of the saws comes through.",
    ],
  },
  air: {
    title: "Air level",
    live: true,
    text: ["How loud the air handling is: a band of pink noise that slowly swells and drifts."],
  },
  airHz: {
    title: "Air tone",
    live: true,
    text: ["Where the band of noise sits.", "Low is the rush of distant ducts. High is a vent hissing close by."],
  },
  choir: {
    title: "Choir level",
    live: true,
    text: ["How loud the choir is, both heard directly and sent to the hall."],
  },
  choirDry: {
    title: "Choir dry",
    live: true,
    text: [
      "How much of the choir is heard directly, beside its reverb.",
      "At zero only the hall is left, as if sung far down a corridor. Turned up, the singers are in the room.",
    ],
  },
  choirCutoff: {
    title: "Choir tone",
    live: true,
    text: ["A low-pass filter on the choir.", "Turned down they are muffled, as if behind a bulkhead."],
  },
  choirTranspose: {
    title: "Choir transpose",
    live: false,
    text: [
      "Moves every chord up or down by semitones. -12 is an octave down.",
      "The recordings stop at G2. Anything lower is the same recording slowed, which darkens it and stretches it out.",
    ],
  },
  choirDetune: {
    title: "Choir detune",
    live: false,
    text: [
      "Bends each note by a random amount, up to this many cents either way.",
      "A few cents thickens the chord. Thirty or more turns it sour and uneasy.",
    ],
  },
  voices: {
    title: "Voices",
    live: false,
    text: [
      "How many of a chord's four notes are sung, counted from the lowest.",
      "One is a lone bass line. Four is the full chord.",
    ],
  },
  spread: {
    title: "Spread",
    live: false,
    text: [
      "How far apart the voices stand. Zero puts them all in the middle, one puts the outer two hard left and right.",
    ],
  },
  chordSecs: {
    title: "Chord length",
    live: false,
    text: [
      "Roughly how long each chord lasts. Each one varies by up to a fifth either way.",
      "Turn it down whilst tuning the choir, so changes arrive sooner.",
    ],
  },
  rest: {
    title: "Rest",
    live: false,
    text: [
      "The chance that a voice sits a chord out.",
      "Higher is sparser, with the odd chord of one or two voices, or none.",
    ],
  },
  stagger: {
    title: "Stagger",
    live: false,
    text: [
      "The longest a voice may come in late.",
      "At zero they enter together, as a block. Higher, the entries overlap like a tide coming in.",
    ],
  },
  attack: {
    title: "Attack",
    live: false,
    text: ["How long a note takes to swell to full."],
  },
  release: {
    title: "Release",
    live: false,
    text: [
      "How long a note takes to die away. It lingers this long into the next chord.",
      "Long releases blur one chord into the next.",
    ],
  },
  grain: {
    title: "Grain",
    live: false,
    text: [
      "A note outlasts its seven-second recording by chaining overlapping stretches of it. This is the length of each.",
      "Short stretches shimmer and never settle. Long ones sound more natural.",
    ],
  },
  crossfade: {
    title: "Crossfade",
    live: false,
    text: [
      "How long neighbouring stretches overlap.",
      "Short, and the joins pulse. Long, and they are smooth. It is capped at just under half the grain.",
    ],
  },
  reverb: {
    title: "Reverb",
    live: true,
    text: [
      "How much of the hall comes back: a dark one, six seconds long.",
      "The choir is sent to it whole, the engine and the air only a little. At zero everything is close and dry.",
    ],
  },
  master: {
    title: "Master level",
    live: true,
    text: ["How loud everything is.", "A limiter follows it, so pushed hard the mix is squashed rather than clipped."],
  },
};
