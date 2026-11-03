import type { AudioKey } from "./steps";

/** A stop on the desk's tour: the introduction, then a control */
export type HelpStep = "intro" | AudioKey;

export const helpIntro = {
  title: "The desk",
  text: [
    "The player's footsteps on a tile deck, one each time a foot of theirs lands: louder and a shade quicker running, quieter crouched or turning on the spot. The step button plays one, shift for a running one.",
    "The fx strip plays the phaser's sounds. Its charge button fills a charge, then fires: shift cancels it instead.",
    "The world strip plays the doors: a button per voice opens one, shift shuts it.",
    "Drag a knob or fader, or focus it and use the arrow keys, with shift for bigger steps. A double click restores its default.",
  ],
};

/** When a change is heard: at once, or from the next step */
export type HelpWhen = "now" | "note";

/** What each control does */
export const help: Record<AudioKey, { title: string; when: HelpWhen; text: string[] }> = {
  steps: {
    title: "Steps level",
    when: "now",
    text: ["How loud the footsteps are. Each step's own level follows the player's gait beneath this."],
  },
  fx: {
    title: "Fx level",
    when: "now",
    text: [
      "How loud the phaser's sounds are: raised, lowered, charging, fired, cooling, and where a shot ends. The buttons above play each.",
    ],
  },
  world: {
    title: "World level",
    when: "now",
    text: [
      "How loud the World's own sounds are: doors sliding open and shut, locking, held, and refusing someone. The buttons above play each.",
    ],
  },
  master: {
    title: "Master level",
    when: "now",
    text: ["How loud everything is.", "A limiter follows it, so pushed hard the mix is squashed rather than clipped."],
  },
};
