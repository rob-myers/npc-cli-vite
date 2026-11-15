/** A reply offered by an ask, e.g. jsh `ask … friend:"[near] A friend"` — see `docs/speech.md` */
export type TalkChoice = {
  key: string;
  text: string;
  /** Keys of what must hold before the player can say it, defined by e.g. jsh `comms` */
  needs?: string[];
};

/** A thread of the speech history: whoever spoke in it, and to whom */
export function threadKeyOf(parties: string[]) {
  return [...new Set(parties)].sort().join(" + ");
}
